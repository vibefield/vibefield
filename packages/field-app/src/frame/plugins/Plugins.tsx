import {
  type FrameView,
  type PluginRecord,
  type PluginRegistrySnapshot,
  PluginRuntimeDiagnosticsSnapshot,
  type PluginsCatalog,
} from "@vibefield/contracts";
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
import { showOnBoard, useBoardNames } from "../../field/desk/pegboard/board-door";
import { usePluginRegistrySnapshot } from "../../plugin-host/plugin-registry-store";
import { useUnstartedPlugins } from "../../plugin-host/unstarted-plugins";
import { useGodviewFindDoor } from "../find-door";
import { type FrameSurface, foldSurface } from "../frame-surface";
import { CommunityTileView, useCommunitySwitch } from "./CommunityTile";
import { PageActView } from "./InstallCard";
import { PluginSettings } from "./PluginSettings";
import { PluginsUpdates } from "./PluginsUpdates";
import { PluginsView } from "./PluginsView";
import { dropCarry, keepCarry, type PluginsCarry, takeCarry } from "./plugins-carry";
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
  type InstallFlow,
  type InstallRefusal,
  installLive,
  installRefusal,
  pageAct,
  refusedWhileUpdating,
} from "./plugins-install";
import {
  catalogFoot,
  type FailedHere,
  installedFoot,
  installedRows,
  type PluginsRead,
  type PluginsTab,
  pluginPage,
  pluginsLayout,
  powerSwitchOf,
  type Refusal,
  refusalStale,
  runtimeFailures,
  shelfState,
  switchable,
  switchKey,
  type UnstartedHere,
  walkHot,
} from "./plugins-model";
import { type PluginsPort, pluginsPortOver } from "./plugins-port";
import { type RemoveAsk, removable, removeQuestion } from "./plugins-remove";
import {
  discoverShelf,
  isShelfKey,
  listedPage,
  shelfCategories,
  shelfColumns,
  shelfOrder,
  shelfShows,
  walkShelf,
} from "./plugins-shelf";
import {
  asksFirst,
  type RowAct,
  removedObjects,
  rowAct,
  takeable,
  type UpdateFlow,
  type UpdateRow,
  updateAllAct,
  updateAllOrder,
  updatePageAct,
  updateRows,
  updatesHead,
} from "./plugins-updates";
import { RemoveView } from "./RemoveQuestion";

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
// Development plugin's one switch (N18: every plugin's but a held one's, below),
// on its row and its page, and its powers' switches (§8 "Its switches"), each a
// request Settings → Plugins sent with the same parameters until N18.
// A switch moves only when fieldd's next snapshot does; while its request is
// out it takes no press (a second press sends nothing), a refusal is said in
// §9's words (never the error's text) until a press or fieldd's snapshot shows
// the switch the way it was turning, and while fieldd isn't answering no switch
// takes a press. Every other plugin's page read only (item 321) until N18.
// MK-4c2b: a Built in or Development plugin's settings (N18: every plugin's but
// a held one's) on its page (§8 "Its settings"), a section the controller
// mounts once per page opening and hands the view, so the view holds no state;
// each setting reads and keeps its value over the requests Settings → Plugins
// sent until N18. No Undo and no Redo on the page
// (James's MK-O6 pick): going back stays in Settings. MK-4e: over a held list
// Discover draws its shelf (`plugins-shelf.ts`) from the list this popup
// already read and the snapshot the window holds; ↑ ↓ walk its tiles a row at
// a time and ← → one at a time while the field holds no words, kept in sight;
// a tile, or ↵ on the hot one, opens its page, and a set this desktop doesn't
// have opens a page read from the list alone. Community sets join only while
// community plugins are on (`community`, which the switch's slice feeds).
// O2-C: such a page's act is Install (`plugins-install.ts`), also the foot's on
// Discover for the hot tile. It downloads first (`prepare`) and the act says so;
// then the install card stands where the act stood, read from the row fieldd
// answered and this desktop's roster; its Install installs what it showed
// (`commit`), and the act says Installing… until the snapshot holds the plugin;
// its Cancel, Esc, leaving the page or folding the popup throws the download
// away (`discard`), and a download that lands after its page was left is thrown
// away as it lands. One install at a time. A failure is worded by its kind,
// never fieldd's text (`installRefusal`): one this VibeField can't run says it
// needs a newer VibeField, and every other §9's line with Try again. ↵ on a
// page presses its act or the card's Install.
// MK-O3D (James's MK-O1 pick B): a community set's install at a desktop that
// hasn't shown the community statement shows it once the download is in, where
// the card would stand. Its Continue marks this desktop and the card stands;
// its Cancel, Esc, leaving the page or folding the popup throws the download
// away, as the card's Cancel does, and marks nothing. ↵ presses nothing there:
// the keyboard is on its Cancel. A mark unread, or one that can't be read,
// shows it (`communitySwitch.shownHere`, read as Install is pressed).
// MK-4f: a plugin from the list's page carries Remove… (`plugins-remove.ts`),
// which asks in place — §8's two-step destructive confirm, Cancel holding the
// keyboard — and its second question, Remove it and its data…; the roster is
// read as Remove… is pressed, for the second's names. A Built in, Development
// or Sideloaded page carries none. The question stands, its buttons taking no
// press, until the snapshot no longer holds the plugin; a refusal is said under
// Remove…, never fieldd's text. Esc, leaving the page or folding the popup is
// its Cancel; whichever way it goes, the keyboard goes back to the field. A
// page whose plugin neither the snapshot nor the list holds closes to its tab.
// MK-UC's UC-C: over a held list Updates draws its head, its rows and its note
// (`plugins-updates.ts`, `PluginsUpdates.tsx`), and an installed plugin's page
// whose update waits says Update. An Update downloads first (`prepareUpdate`);
// when fieldd says the plugin downloaded can do no more than the version you
// have and it removes no object, it is taken at once (`commit`), and otherwise
// the update card — the install card's own — stands where the act stood, its
// Update taking it and its Cancel throwing the download away (`discard`). One
// update or install at a time; leaving where it stands lets a card go, as an
// install's; the snapshot holding the new version ends it, and its row says
// Updated to until the popup folds. Update all takes the rows one at a time,
// waiting at each card. Check again reads the list once per press. MK-E6: as an
// install or an update of a plugin with objects is sent, a note is kept in the
// window's own session (`plugins-carry.ts`), so a window that comes back fresh
// opens the popup where it stood (`FramePlugins`); folding lets the note go.
// Its doors (MK-4b) are the Me menu's Plugins… row and the palette's Plugins…
// and Check plugins for updates, each through ChromeLayer's `openPlugins`; the
// pegboard's More in Plugins… (MK-4d) is one more, on Discover. MK-4d: an
// installed page's act also offers Show them on the pegboard, handing the set
// to the board's door (`showOnBoard`); ↵ presses it, never while Remove…'s
// question stands. MK-4d's names (James's MK-O10 pick A): Installed's lines
// and a page's What it adds say where a set hangs by the pegboard's own names,
// read from the same door (`useBoardNames`; with no desk mounted, as in the
// catalog, no place is said). Those two are the popup's only imports from the
// desk. The catalog mounts this controller over a fixture port
// (`design-system/PluginsPreview.tsx`).
// MK-O3D: Discover's community tile and its switch (§8 "The community tile",
// drawn 2026-11-14): the switch as fieldd's app preferences say it, the ask in
// place, which Esc answers first, and the one request. The statement is shown
// once on each desktop (James's MK-O1 pick B): this desktop's mark is read
// while the tile stands or community plugins are on, and its ask marks it. The
// tile mounts at Discover's end, and a held list's foot says "· community off"
// while it is off.
// Item 476: Installed's row for a plugin that is on and cannot start in THIS
// window says it isn't working. The registry snapshot cannot say that of one
// window, so the frame hands in the window's own set of them (`unstarted`,
// `plugin-host/unstarted-plugins.ts`) beside the snapshot; a plate passes none.
// MK-5b (§8 "Installed", MK-5b's drawing): so does a plugin whose runtime
// fieldd says failed, which the frame reads while the popup stands
// (`plugins.runtime.subscribe`, `runtimeFailures`) and hands in (`failed`).
// A row whose switch stands here then offers Try again (N18, 2026-11-17: Try
// again follows the switch, not a Built in or Development one's alone, VF-PM
// 19:45:16Z), which turns it off and on over its switch's two requests and its
// switch's key, so neither takes a press until both are answered; it stands
// meanwhile, and the keyboard stays in the field. A refusal is the switch's,
// said by the request fieldd refused. A read the client ended reads as none
// failed. And where neither door answered, Discover and Updates offer Try again
// in the foot, ↵ printed on it, which reads the list again as an opening does,
// once per press (MK-D5: the person's act); Installed says the same sentence
// with no act while it holds no plugins.
// Item 433: Discover draws the pegboard's categories (`shelfCategories`), by
// the board's names this controller already reads (`useBoardNames`), and a
// category chosen keeps the sets that hang there. Each opening starts on the
// category its door asked for (`initialCategory`: the pegboard's More in
// Plugins… hands the board's; every other door All); one Discover does not
// offer shows All, and so does a list held with none. Typed words search every
// set, and the category comes back once they are gone. A press on the row by
// the pointer gives the keyboard back to the field, as a tile's press does.
// N18 (the MK inventory's A2 at its lean): the switches and the settings above
// stand for every plugin, whatever its source, but one held while community
// plugins are off (`controlsHere`): a plugin from the plugin list and a
// Sideloaded one read only no more. fieldd decides the stop (O3-C), so the
// window reads no source to decide them. Settings → Plugins sends none of
// these requests now: this popup is their one place.

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
  /** Item 476: the plugins that cannot start in this window, by id; none passed: none. */
  unstarted?: UnstartedHere;
  /** MK-5b: the plugins whose runtime fieldd says failed, by id; none passed: none. */
  failed?: FailedHere | undefined;
  /** Whether Esc is heard on the window. A catalog plate binds none. */
  bindKeys?: boolean;
  /** Where the scrim and the popup are drawn: the document's body in the
   * product, a catalog plate's box in the catalog. */
  container?: HTMLElement | null;
  /** Whether opening takes the keyboard. A plate drawn open must not. */
  takeFocus?: boolean;
  /** The tab each opening starts on (Discover; a plate may start elsewhere). */
  initialTab?: PluginsTab;
  /** Item 433: the category Discover starts on each opening, `""` All (More in Plugins… hands the board's). */
  initialCategory?: string;
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
  /** O2-C: whether each opening presses its starting page's Install, so a plate shows the download, the card or
   * a failure (a plate's; the product passes none). */
  initialInstall?: boolean;
  /** O2-C: whether that opening then presses the card's Install once it stands, so a plate shows Installing… (a
   * plate's; the product passes none). */
  initialConfirm?: boolean;
  /** MK-UC's UC-C (MK-E6): the updates Update all took and still had to take when the window came back fresh,
   * which the next opening shows and goes on with (`FramePlugins`' note; a plate passes none). */
  resume?: Pick<PluginsCarry, "rest" | "done"> | null;
  /** MK-UC's UC-C: a plugin whose row's Update each opening presses once Updates' rows are read, so a plate shows
   * the download or the update card (a plate's; the product passes none). */
  initialUpdate?: string | null;
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
  unstarted,
  failed,
  bindKeys = true,
  container,
  takeFocus = true,
  initialTab = "discover",
  initialCategory = "",
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
  initialInstall = false,
  initialConfirm = false,
  resume = null,
  initialUpdate = null,
  now = Date.now,
}: PluginsProps): ReactElement | null {
  const open = surface === "plugins";
  const [tab, setTab] = useState<PluginsTab>(initialTab);
  const [query, setQuery] = useState("");
  // item 433: the category Discover's shelf was asked to show, `""` All; it shows All while Discover
  // offers no such category (below)
  const [category, setCategory] = useState(initialCategory);
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
  // MK-5b: the plugins whose row's Try again is under way, by id, so it stands, taking no press, while
  // the plugin is off between its two requests
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(() => new Set());
  // O2-C: the one install under way, kept in a ref too, so an answer that lands late knows whether its install
  // is still the one the window holds
  const flowNow = useRef<InstallFlow | null>(null);
  const [flow, setFlow] = useState<InstallFlow | null>(null);
  const putFlow = useCallback((next: InstallFlow | null) => {
    flowNow.current = next;
    setFlow(next);
  }, []);
  // MK-4f: Remove…'s question standing on a page, and the plugin whose last removal fieldd refused
  const [removing, setRemoving] = useState<RemoveAsk | null>(null);
  const [removeRefused, setRemoveRefused] = useState<string | null>(null);
  // MK-UC's UC-C: the one update under way, in a ref too as the install's is; the updates this opening took (by
  // plugin, the version taken) and those that didn't happen; what Update all still has to take; and the newest of
  // what an answer that lands late reads (the snapshot, the page, Updates' rows), each kept in a ref
  const updateNow = useRef<UpdateFlow | null>(null);
  const [update, setUpdate] = useState<UpdateFlow | null>(null);
  const putUpdate = useCallback((next: UpdateFlow | null) => {
    updateNow.current = next;
    setUpdate(next);
  }, []);
  const [updated, setUpdated] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [unmade, setUnmade] = useState<ReadonlyMap<string, InstallRefusal>>(() => new Map());
  const [allRest, setAllRest] = useState<readonly string[]>([]);
  const updatedNow = useRef(updated);
  const allRestNow = useRef(allRest);
  const snapshotNow = useRef(snapshot);
  const pageNow = useRef<OpenPage | null>(null);
  const updatesNow = useRef<readonly UpdateRow[] | null>(null);
  // Check again's read: a later one, or a new opening, leaves an earlier answer untaken
  const checkTurn = useRef(0);
  useLayoutEffect(() => {
    updatedNow.current = updated;
    allRestNow.current = allRest;
    snapshotNow.current = snapshot;
    pageNow.current = page;
  }, [updated, allRest, snapshot, page]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocus = useRef<Element | null>(null);
  // The read below runs once per opening; whoever hears its answers may change
  // without starting another read.
  const heard = useRef(onCatalog);
  useLayoutEffect(() => {
    heard.current = onCatalog;
  }, [onCatalog]);
  // MK-4f: whether the popup stands now, for an answer that lands late: a refusal gives the field the keyboard
  // only while it stands
  const openNow = useRef(open);
  useLayoutEffect(() => {
    openNow.current = open;
  }, [open]);

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
      setCategory(initialCategory);
      setPage(pageAt(initialPage, initialTab));
      setHot(0);
      setRefused(new Map());
      // the last opening's "neither door answered" is not this one's: it says
      // the read until this one's doors answer (a held list stays, shown at once)
      setRead((was) => (was.kind === "away" ? { kind: "asking" } : was));
      setBox(boxOf(container));
      // MK-UC's UC-C: each opening's Updates starts with nothing taken and nothing failed, but for what Update all
      // took and had left to take when the window came back fresh (MK-E6)
      setUpdated(new Map(resume?.done ?? []));
      setUnmade(new Map());
      setAllRest(resume?.rest ?? []);
      if (takeFocus) {
        const before = document.activeElement;
        returnFocus.current = before !== null && before !== document.body ? before : null;
      }
    }
  }

  // THE READ (MK-D5): one `catalog` for the list held, shown at once, and one
  // `refresh`. A refresh that answers is the newer list, so a late `catalog`
  // never replaces it; neither door answering is said, never a blank. An
  // answer is taken while `current` says the read is still the popup's.
  // MK-5b: an opening reads it, and so does Try again where neither door
  // answered (`readAgain`, below).
  const readList = useCallback(
    (current: () => boolean) => {
      let fresh = false;
      let heldAnswered = false;
      let refreshFailed = false;
      setReading(true);
      port.catalog().then(
        (catalog) => {
          heldAnswered = true;
          if (current() && !fresh) {
            setRead({ kind: "answered", catalog });
            heard.current?.(catalog);
          }
        },
        () => {
          heldAnswered = true;
          if (current() && refreshFailed) {
            setRead((was) => (was.kind === "asking" ? { kind: "away" } : was));
          }
        },
      );
      port.refresh().then(
        (catalog) => {
          fresh = true;
          if (!current()) return;
          setRead({ kind: "answered", catalog });
          setReading(false);
          heard.current?.(catalog);
        },
        () => {
          refreshFailed = true;
          if (!current()) return;
          setReading(false);
          if (heldAnswered) setRead((was) => (was.kind === "asking" ? { kind: "away" } : was));
        },
      );
    },
    [port],
  );

  // THE READ ON OPEN (MK-D5): the read above once per opening — never on a
  // re-render, never on a timer.
  useEffect(() => {
    if (!open) return;
    let current = true;
    // a Check again from an earlier opening is not this one's
    checkTurn.current += 1;
    readList(() => current);
    return () => {
      current = false;
    };
  }, [open, readList]);

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

  // O2-C: an install the window lets go of. A card standing throws its download away (`discard`); a download
  // still running is thrown away as it lands (`install`, below); a failure's line goes. An install whose card's
  // Install was pressed is fieldd's now, and is kept until the snapshot holds its plugin. MK-O3D: the community
  // statement standing throws its download away, as the card does.
  const dropInstall = useCallback(() => {
    const was = flowNow.current;
    if (was === null || was.at.step === "installing") return;
    if (was.at.step === "card" || was.at.step === "statement") {
      void port.discard(was.at.candidate).catch(() => undefined);
    }
    putFlow(null);
  }, [port, putFlow]);
  // the card's Cancel, pressed or Esc: its download goes, and the keyboard goes back to the field
  const cancelInstall = useCallback(() => {
    dropInstall();
    if (takeFocus) inputRef.current?.focus({ preventScroll: true });
  }, [dropInstall, takeFocus]);

  // MK-UC's UC-C: an update the window lets go of — its card's Cancel, Esc, leaving where it stands, the popup
  // folding. A card standing throws its download away (`discard`); a download still running is thrown away as it
  // lands (`startUpdate`, below). One whose Update was sent is fieldd's now, kept until the snapshot holds it.
  const dropUpdate = useCallback(() => {
    const was = updateNow.current;
    if (was === null || was.at.step === "updating") return;
    if (was.at.step === "card") void port.discard(was.at.candidate).catch(() => undefined);
    putUpdate(null);
  }, [port, putUpdate]);
  // the update card's Cancel, pressed or Esc, as the install card's: the keyboard goes back to the field
  const cancelUpdate = useCallback(() => {
    dropUpdate();
    if (takeFocus) inputRef.current?.focus({ preventScroll: true });
  }, [dropUpdate, takeFocus]);
  // an update that didn't happen says so on its row and its page, by its refusal's kind alone, never its text
  // (`installRefusal`, as an install's): Try again, or Needs a newer VibeField; its note goes
  const failUpdate = useCallback(
    (id: string, error: unknown) => {
      setUnmade((was) => new Map(was).set(id, installRefusal(error)));
      putUpdate(null);
      dropCarry();
    },
    [putUpdate],
  );
  // its Update sent: the act says Updating… until the snapshot holds the version. For a plugin with objects the
  // note is kept first (MK-E6): the page it stands on and the tab it came from, or, during Update all, what it took
  // (this one with it) and what it still has to take.
  const takeUpdate = useCallback(
    (from: UpdateFlow, candidate: string, record: PluginRecord) => {
      const taking: UpdateFlow = { ...from, at: { step: "updating", version: record.version } };
      putUpdate(taking);
      const installed = snapshotNow.current?.plugins.find((plugin) => plugin.id === from.id);
      const objects =
        (installed?.contributions.objects.length ?? 0) + record.contributions.objects.length;
      if (objects > 0) {
        const opened = from.where === "page" ? (pageNow.current?.from ?? "updates") : "updates";
        keepCarry({
          page: from.all ? null : { id: from.id, from: opened },
          rest: from.all ? allRestNow.current : [],
          done: from.all ? [...updatedNow.current, [from.id, record.version]] : [],
        });
      }
      port.commit(candidate).then(
        () => undefined,
        (error: unknown) => {
          if (updateNow.current === taking) failUpdate(from.id, error);
        },
      );
    },
    [port, putUpdate, failUpdate],
  );
  // Update, Update…, Try again, or Update all's next: download it, pinned to the version its row shows. When fieldd
  // says it can do no more than the version you have and it leaves no object missing, it is taken at once (one
  // press); otherwise its card stands where its act stood. One update or install at a time; a card standing
  // elsewhere is let go. No press while fieldd isn't answering. The keyboard stays in the field, as an Install's.
  const startUpdate = useCallback(
    (id: string, where: "row" | "page", all: boolean) => {
      const step = updateNow.current?.at.step;
      const installing = flowNow.current?.at.step;
      if (away || step === "downloading" || step === "updating") return;
      if (installing === "downloading" || installing === "installing") return;
      const row = updatesNow.current?.find((candidate) => candidate.id === id);
      if (row === undefined || !takeable(row)) return;
      dropUpdate();
      setUnmade((was) => {
        if (!was.has(id)) return was;
        const next = new Map(was);
        next.delete(id);
        return next;
      });
      const started: UpdateFlow = { id, where, all, at: { step: "downloading" } };
      putUpdate(started);
      if (takeFocus) inputRef.current?.focus({ preventScroll: true });
      port.prepareUpdate(id, row.to).then(
        (prepared) => {
          if (updateNow.current !== started) {
            void port.discard(prepared.candidate).catch(() => undefined);
            return;
          }
          const installed = snapshotNow.current?.plugins.find((plugin) => plugin.id === id);
          const removes = installed === undefined ? [] : removedObjects(installed, prepared.record);
          // fieldd says what it can do that the version you have can't; one that doesn't say asks first
          const asksFor = prepared.update?.asksFor ?? null;
          if (!asksFirst(asksFor, removes)) {
            takeUpdate(started, prepared.candidate, prepared.record);
            return;
          }
          const { candidate, record } = prepared;
          putUpdate({ ...started, at: { step: "card", candidate, record, asksFor, removes } });
        },
        (error: unknown) => {
          if (updateNow.current === started) failUpdate(id, error);
        },
      );
    },
    [away, port, putUpdate, dropUpdate, takeUpdate, failUpdate, takeFocus],
  );
  // the card's Update takes what it showed
  const confirmUpdate = useCallback(() => {
    const was = updateNow.current;
    if (away || was === null || was.at.step !== "card") return;
    takeUpdate(was, was.at.candidate, was.at.record);
    if (takeFocus) inputRef.current?.focus({ preventScroll: true });
  }, [away, takeUpdate, takeFocus]);

  // MK-4f: Remove… asks, and reads the roster for its second question's names (none said if it can't be read)
  const askRemove = useCallback(
    (id: string) => {
      if (away) return;
      setRemoveRefused(null);
      setRemoving({ id, step: "ask", roster: null, sending: false });
      port.desktops().then(
        (roster) => setRemoving((was) => (was?.id === id ? { ...was, roster } : was)),
        () => undefined,
      );
    },
    [away, port],
  );
  // Remove it and its data… turns the question into its second
  const askRemoveData = useCallback(() => {
    setRemoving((was) => (was === null || was.sending ? was : { ...was, step: "ask-data" }));
  }, []);
  // its Cancel: the question goes, and the keyboard goes back to the field; one whose request is out stands
  const cancelRemove = useCallback(() => {
    setRemoving((was) => (was?.sending === true ? was : null));
    if (takeFocus) inputRef.current?.focus({ preventScroll: true });
  }, [takeFocus]);
  // Remove, or Remove data: one request; the question stands until the snapshot no longer holds the plugin, and
  // a refusal is said under Remove…
  const confirmRemove = useCallback(() => {
    if (away || removing === null || removing.sending) return;
    const { id, step } = removing;
    setRemoving({ ...removing, sending: true });
    port.uninstall(id, step === "ask-data").then(
      () => undefined,
      () => {
        setRemoving((was) => (was?.id === id ? null : was));
        setRemoveRefused(id);
        // the question's buttons went with it, so the keyboard goes back to the field while the popup stands
        if (takeFocus && openNow.current) inputRef.current?.focus({ preventScroll: true });
      },
    );
  }, [away, removing, port, takeFocus]);
  useEffect(() => {
    if (removing === null || snapshot === null) return;
    if (snapshot.plugins.some((plugin) => plugin.id === removing.id)) return;
    setRemoving(null);
    if (open && takeFocus) inputRef.current?.focus({ preventScroll: true });
  }, [open, snapshot, removing, takeFocus]);
  // the question and a refusal's line belong to their page: leaving it, or folding the popup, lets them go
  useEffect(() => {
    const here = open ? page?.id : undefined;
    setRemoving((was) => (was !== null && was.id !== here ? null : was));
    setRemoveRefused((was) => (was !== null && was !== here ? null : was));
  }, [open, page]);

  // While open, Esc is the popup's before anything else hears it, and answers
  // the nearest first (§8 "Keys"): the install card or the community statement
  // where it stands (MK-O3D; its Cancel), or Remove…'s question (its Cancel),
  // then the community tile's ask goes back (MK-O3D), then a page goes back to
  // its tab, then the popup folds.
  useEffect(() => {
    if (!open || !bindKeys) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const step = flowNow.current?.at.step;
      if (step === "card" || step === "statement") cancelInstall();
      // MK-UC's UC-C: the update card's Cancel, as the install card's
      else if (updateNow.current?.at.step === "card") cancelUpdate();
      else if (removing !== null) cancelRemove();
      else if (asking) cancelAsk();
      else if (page !== null) back();
      else fold();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    open,
    bindKeys,
    fold,
    page,
    back,
    asking,
    cancelAsk,
    cancelInstall,
    cancelUpdate,
    removing,
    cancelRemove,
  ]);

  // MK-UC's UC-C: an update belongs to where it stands — a row's to Updates' list, a page's to its page. Leaving it
  // (a tab, a page, the back row) or folding the popup lets a card or a download go, and Update all stops after the
  // update under way. Folding lets the note go (MK-E6), and so does the window closing the popup, or its port
  // changing, as the install's goodbye does; a window coming back fresh runs no such goodbye, so its note stands.
  useEffect(() => {
    const onUpdates = open && page === null && tab === "updates";
    if (!onUpdates) setAllRest([]);
    const was = updateNow.current;
    if (was === null) return;
    const here = !open ? false : was.where === "page" ? page?.id === was.id : onUpdates;
    if (!here) dropUpdate();
  }, [open, page, tab, dropUpdate]);
  useEffect(() => {
    if (!open) dropCarry();
  }, [open]);
  useEffect(
    () => () => {
      dropUpdate();
      dropCarry();
    },
    [dropUpdate],
  );

  // O2-C: the install belongs to its page. Leaving the page — its back row, a tab, typed words — or folding the
  // popup lets it go, so nothing waits in fieldd for a card no one sees. The window closing, or its port changing,
  // lets it go too: the install the window held is no longer its, so a download still running is thrown away as
  // it lands.
  useEffect(() => {
    const was = flowNow.current;
    if (was !== null && (!open || page === null || page.id !== was.id)) dropInstall();
  }, [open, page, dropInstall]);
  useEffect(() => () => dropInstall(), [dropInstall]);
  // O2-C: an install is done when the plugins this desktop has hold it; its page then reads the installed record
  useEffect(() => {
    if (flow?.at.step !== "installing") return;
    if (snapshot?.plugins.some((plugin) => plugin.id === flow.id) === true) putFlow(null);
  }, [snapshot, flow, putFlow]);
  // MK-UC's UC-C: an update is done when the plugins this desktop has hold its version: its row then says Updated
  // to, and its page Installed. A plugin gone from them ends it with nothing to say.
  useEffect(() => {
    const at = update?.at;
    if (update === null || at === undefined || at.step !== "updating" || snapshot === null) return;
    const record = snapshot.plugins.find((plugin) => plugin.id === update.id);
    if (record !== undefined && record.version !== at.version) return;
    if (record !== undefined) setUpdated((was) => new Map(was).set(update.id, at.version));
    putUpdate(null);
  }, [snapshot, update, putUpdate]);

  // O2-C: Install, or Try again — download it, and read the roster with it; then the card stands, unless the
  // window let this install go meanwhile, when the download is thrown away as it lands. A second install drops
  // the first. No press while fieldd isn't answering. A refusal is kept by its kind alone (`installRefusal`),
  // never its text, which can name VibeField's insides. The keyboard stays in the field, as a row's press keeps it.
  // MK-O3D (MK-O1 B): whether an install shows the community statement before its card, read as Install is
  // pressed — a community set's, at a desktop that hasn't shown it — kept in a ref (set once the list held and
  // this desktop's mark are known, below), so `install` keeps its identity.
  const { markShown, shownHere } = communitySwitch;
  const statementFirst = useRef<(id: string) => boolean>(() => false);
  const install = useCallback(
    (id: string) => {
      // one install at a time: an Install pressed is fieldd's until the snapshot holds it; MK-UC: and none while
      // an update downloads or runs
      const updating = updateNow.current?.at.step;
      if (away || flowNow.current?.at.step === "installing") return;
      if (updating === "downloading" || updating === "updating") return;
      dropInstall();
      const started: InstallFlow = { id, at: { step: "downloading" } };
      const first = statementFirst.current(id);
      putFlow(started);
      if (takeFocus) inputRef.current?.focus({ preventScroll: true });
      Promise.all([port.prepare(id), port.desktops().catch(() => null)]).then(
        ([prepared, roster]) => {
          if (flowNow.current !== started) {
            void port.discard(prepared.candidate).catch(() => undefined);
            return;
          }
          const { candidate, record } = prepared;
          putFlow({
            id,
            at: first
              ? { step: "statement", candidate, record, roster }
              : { step: "card", candidate, record, roster },
          });
        },
        (error: unknown) => {
          if (flowNow.current !== started) return;
          putFlow({ id, at: { step: "failed", refusal: installRefusal(error) } });
        },
      );
    },
    [away, port, putFlow, dropInstall, takeFocus],
  );
  // O2-C: the card's Install installs what it showed; the act says Installing… until the snapshot holds it
  const confirm = useCallback(() => {
    const was = flowNow.current;
    if (away || was === null || was.at.step !== "card") return;
    const installing: InstallFlow = {
      id: was.id,
      at: { step: "installing", objects: was.at.record.contributions.objects.length },
    };
    putFlow(installing);
    if (takeFocus) inputRef.current?.focus({ preventScroll: true });
    // MK-UC's UC-C (MK-E6): the install's own note, as an update's, for a plugin with objects
    if (was.at.record.contributions.objects.length > 0) {
      keepCarry({
        page: { id: was.id, from: pageNow.current?.from ?? "discover" },
        rest: [],
        done: [],
      });
    }
    port.commit(was.at.candidate).then(
      () => undefined,
      (error: unknown) => {
        if (flowNow.current !== installing) return;
        putFlow({ id: was.id, at: { step: "failed", refusal: installRefusal(error) } });
        dropCarry();
      },
    );
  }, [away, port, putFlow, takeFocus]);
  // MK-O3D (MK-O1 B): the statement's Continue marks this desktop, and the card stands where it stood; the
  // keyboard goes back to the field, as after a download. A mark that fails is no mark, so the next asks again.
  const goOn = useCallback(() => {
    const was = flowNow.current;
    if (away || was === null || was.at.step !== "statement") return;
    markShown();
    const { candidate, record, roster } = was.at;
    putFlow({ id: was.id, at: { step: "card", candidate, record, roster } });
    if (takeFocus) inputRef.current?.focus({ preventScroll: true });
  }, [away, markShown, putFlow, takeFocus]);
  // a plate's opening presses its page's Install (`initialInstall`), and then the card's (`initialConfirm`)
  useEffect(() => {
    if (open && initialInstall && initialPage !== null) install(initialPage);
  }, [open, initialInstall, initialPage, install]);
  useEffect(() => {
    if (open && initialConfirm && flow?.at.step === "card") confirm();
  }, [open, initialConfirm, flow, confirm]);

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
  // MK-4d's names: the pegboard's own names for its categories, by which a row's line and a page's
  // What it adds say where a set hangs; null with no desk mounted, and then no place is said
  const names = useBoardNames();
  // Q6: the field's words filter Installed's rows and (MK-4e) Discover's shelf;
  // Updates' search waits for its rows, and the words are kept across the switch.
  // Item 476: a row of a plugin in the window's own set says it isn't working. MK-5b: so does one
  // whose runtime fieldd says failed, and one whose switch stands here offers Try again (N18,
  // 2026-11-17: Try again follows the switch, not a Built in or Development one's alone), which
  // stands while its press is under way, the plugin off between its two requests included.
  const installed = useMemo(() => {
    if (snapshot === null) return null;
    const rows = installedRows(snapshot, catalog, query, names, unstarted, failed);
    return retrying.size === 0
      ? rows
      : rows.map((row) => (retrying.has(row.id) ? { ...row, retry: true as const } : row));
  }, [snapshot, catalog, query, names, unstarted, failed, retrying]);
  // Item 433: Discover's categories over a held list, by the board's names (none with no board, or while words
  // are typed), and the one the shelf shows: the one asked for while Discover offers it, else All
  const categories = useMemo(
    () =>
      catalog === null || shelf.kind !== "counted"
        ? []
        : shelfCategories(catalog, community === true, names, query),
    [catalog, shelf.kind, community, names, query],
  );
  const shownCategory = categories.some((offered) => offered.id === category) ? category : "";
  // a category chosen on the row: the hot tile starts at its first, as a tab's does; the one shown
  // pressed again (the kit hands on every press) keeps the hot tile where it is
  const onCategory = useCallback(
    (id: string) => {
      setCategory(id);
      if (id !== shownCategory) setHot(0);
    },
    [shownCategory],
  );
  // a press on the row by the pointer gives the keyboard back to the field, as a tile's press does,
  // so ↵ and the field's keys go on working (§8 "Discover", item 433); the row reached by Tab keeps
  // ← → Home End, the kit's
  const onCategoryPressed = useCallback(() => {
    if (takeFocus) inputRef.current?.focus({ preventScroll: true });
  }, [takeFocus]);
  // MK-4e: Discover's shelf, over a held list with a set to show or typed words to answer; its columns fit the
  // popup's width, and its tiles in the order the keys walk them. Item 433: the category it shows, too
  const discover = useMemo(() => {
    if (catalog === null || shelf.kind !== "counted") return null;
    const built = discoverShelf(catalog, snapshot, query, community === true, shownCategory);
    return shelfShows(built) ? built : null;
  }, [catalog, shelf.kind, snapshot, query, community, shownCategory]);
  const columns = shelfColumns(layout.width);
  const tiles = useMemo(() => (discover === null ? [] : shelfOrder(discover)), [discover]);
  // MK-UC's UC-C: Updates' rows over a held list — every one, which a page and an Update read, and those that hold
  // the field's words, which the tab shows — with what holds the presses (an update or an install downloading or
  // sent) and each row's act
  const updatesAll = useMemo(
    () =>
      catalog === null || shelf.kind !== "counted" || snapshot === null
        ? null
        : updateRows(snapshot, catalog, "", updated),
    [catalog, shelf.kind, snapshot, updated],
  );
  const updateList = useMemo(
    () =>
      catalog === null || shelf.kind !== "counted" || snapshot === null
        ? null
        : updateRows(snapshot, catalog, query, updated),
    [catalog, shelf.kind, snapshot, query, updated],
  );
  useLayoutEffect(() => {
    updatesNow.current = updatesAll;
  }, [updatesAll]);
  const updateBusy = update !== null && update.at.step !== "card";
  const busy = updateBusy || flow?.at.step === "downloading" || flow?.at.step === "installing";
  const actOfRow = useCallback(
    (row: UpdateRow): RowAct =>
      rowAct({
        row,
        flow: update,
        failed: unmade,
        busy,
        state: catalog?.state ?? null,
        away,
        snapshot,
        onMac,
      }),
    [update, unmade, busy, catalog, away, snapshot, onMac],
  );
  const rowActs = useMemo(
    () => new Map<string, RowAct>((updateList ?? []).map((row) => [row.id, actOfRow(row)])),
    [updateList, actOfRow],
  );
  // the hot row or tile, held to those there are
  const walked =
    tab === "installed"
      ? (installed?.length ?? 0)
      : tab === "discover"
        ? tiles.length
        : (updateList?.length ?? 0);
  const hotAt = Math.max(0, Math.min(hot, walked - 1));
  // a page reads the record the window holds; a plugin gone from it closes its page, unless the list held
  // offers it (MK-4e: a set this desktop doesn't have, read from the list alone)
  const shown = useMemo(() => {
    if (page === null) return null;
    const record = snapshot?.plugins.find((plugin) => plugin.id === page.id);
    if (record !== undefined && snapshot !== null) {
      return pluginPage(record, catalog, snapshot, onMac, names);
    }
    const entry = catalog?.plugins.find((listed) => listed.id === page.id);
    return entry === undefined ? null : listedPage(entry);
  }, [page, snapshot, catalog, onMac, names]);
  // MK-4f: so a page whose plugin went closes to its tab (one removed that the list doesn't hold), and its keys
  // walk again, once both the snapshot and a list have answered; before either, nothing is known gone
  useEffect(() => {
    if (open && page !== null && shown === null && snapshot !== null && catalog !== null) back();
  }, [open, page, shown, snapshot, catalog, back]);
  // MK-UC's UC-C: an installed plugin's page whose update waits, or is under way, takes its row's act
  const pageUpdate = useMemo(() => {
    if (shown === null || !shown.installed) return null;
    const row = updatesAll?.find((candidate) => candidate.id === shown.id);
    return row === undefined ? null : actOfRow(row);
  }, [shown, updatesAll, actOfRow]);
  // O2-C: what stands where its act stands, and what ↵ on the page presses
  const act = useMemo(
    () =>
      shown === null
        ? null
        : pageUpdate !== null
          ? updatePageAct(pageUpdate, shown.title)
          : pageAct({
              page: shown,
              entry: catalog?.plugins.find((listed) => listed.id === shown.id),
              state: catalog?.state ?? null,
              flow,
              // MK-UC: no Install takes a press while an update downloads or runs
              away: away || updateBusy,
              community,
              snapshot,
              onMac,
            }),
    [shown, pageUpdate, catalog, flow, away, updateBusy, community, snapshot, onMac],
  );
  // MK-O3D (MK-O1 B): what an Install pressed reads, kept current: a community set's install shows the statement
  // first while this desktop's mark is not read as shown
  useLayoutEffect(() => {
    statementFirst.current = (id) =>
      shownHere !== true &&
      catalog?.plugins.find((listed) => listed.id === id)?.listedAs === "community";
  }, [catalog, shownHere]);
  const pressAct = useCallback((): boolean => {
    if (shown === null || act === null) return false;
    // MK-4d: an installed plugin's page presses Show them on the pegboard, for a set the board hangs, never
    // while Remove…'s question stands on it (MK-4f). The press folds nothing itself: the board's rise folds the
    // popup, or over a covered view the move to Canvas
    if (act.kind === "installed") {
      if (act.show.length === 0 || removing !== null) return false;
      showOnBoard(act.show);
      return true;
    }
    if (pageUpdate !== null) {
      if ((act.kind === "update" || act.kind === "failed") && act.live) {
        startUpdate(shown.id, "page", false);
        return true;
      }
      if (act.kind === "card" && act.live) {
        confirmUpdate();
        return true;
      }
      return false;
    }
    if ((act.kind === "install" || act.kind === "failed") && act.live) {
      install(shown.id);
      return true;
    }
    if (act.kind === "card" && act.live) {
      confirm();
      return true;
    }
    return false;
  }, [shown, act, removing, pageUpdate, startUpdate, confirmUpdate, install, confirm]);
  // MK-4f: Remove… stands on the page of an installed plugin from the list, with its question when one stands
  const removeShown = useMemo(() => {
    if (shown === null || !shown.installed) return undefined;
    const record = snapshot?.plugins.find((plugin) => plugin.id === shown.id);
    return record !== undefined && removable(record) ? record : undefined;
  }, [shown, snapshot]);
  const removeAsking = removing !== null && removing.id === removeShown?.id ? removing : null;
  // O2-C: the foot's act on Discover — the hot tile's Install opens its page and presses it there
  const hotTile = tab === "discover" && page === null ? tiles[hotAt] : undefined;
  const live =
    installLive(catalog?.state ?? null, away) && flow?.at.step !== "installing" && !updateBusy;
  const installHot = useMemo(
    () =>
      hotTile?.act === "install" && live
        ? () => {
            setPage({ id: hotTile.id, from: "discover" });
            install(hotTile.id);
          }
        : null,
    [hotTile, live, install],
  );

  // MK-UC's UC-C: Update all — the rows the tab shows that can be taken, plugins with no object first, one at a
  // time; it goes on once the update under way is done, didn't happen, or its card was answered (never while the
  // popup is folded or Updates is left, which stop it), and passes a row typed words have since hidden
  const onAll = useCallback(() => {
    const [first, ...rest] = updateAllOrder(updateList ?? []);
    if (first === undefined) return;
    setAllRest(rest);
    startUpdate(first, "row", true);
  }, [updateList, startUpdate]);
  useEffect(() => {
    if (!open || update !== null || allRest.length === 0 || updateList === null) return;
    const [next, ...rest] = allRest;
    setAllRest(rest);
    if (next !== undefined && updateList.some((row) => row.id === next)) {
      startUpdate(next, "row", true);
    }
  }, [open, update, allRest, updateList, startUpdate]);
  // a row's card or download goes with its row: typed words that hide the row let it go
  useEffect(() => {
    const was = updateNow.current;
    if (was === null || was.where !== "row" || updateList === null) return;
    if (!updateList.some((row) => row.id === was.id)) dropUpdate();
  }, [updateList, dropUpdate]);
  // a plate's opening presses a row's Update (`initialUpdate`) once, as soon as its rows are read
  const platePressed = useRef(false);
  useEffect(() => {
    if (!open) platePressed.current = false;
    if (!open || initialUpdate === null || updatesAll === null || platePressed.current) return;
    platePressed.current = true;
    startUpdate(initialUpdate, "row", false);
  }, [open, initialUpdate, updatesAll, startUpdate]);
  // Check again: one read per press, the person's act (MK-D5), none while a read runs; its answer is taken as an
  // opening's is, the Me row's count with it
  const checkAgain = useCallback(() => {
    if (reading || away) return;
    checkTurn.current += 1;
    const turn = checkTurn.current;
    setReading(true);
    port.refresh().then(
      (answer) => {
        if (checkTurn.current !== turn) return;
        setRead({ kind: "answered", catalog: answer });
        setReading(false);
        heard.current?.(answer);
      },
      () => {
        if (checkTurn.current === turn) setReading(false);
      },
    );
  }, [reading, away, port]);
  // MK-5b: Try again where neither door answered (§8 "Its states, in the body"): the read again, as an opening
  // reads it, once per press, the person's act (MK-D5); none while a read runs or fieldd isn't answering. A later
  // read, a Check again or a new opening leaves its answers untaken, and so does the popup folding. The body then
  // says the read and the act leaves the foot, so the keyboard goes to the field, as Show installed and Install
  // send it.
  const readAgain = useCallback(() => {
    if (reading || away) return;
    checkTurn.current += 1;
    const turn = checkTurn.current;
    setRead({ kind: "asking" });
    readList(() => openNow.current && checkTurn.current === turn);
    if (takeFocus) inputRef.current?.focus({ preventScroll: true });
  }, [reading, away, readList, takeFocus]);
  // offered on Discover and Updates alone, in the foot; Installed says the same sentence with no act
  const tryAgain = page === null && tab !== "installed" && shelf.kind === "away" ? readAgain : null;

  // A switch's one request (§8 "Its switches"): none while fieldd isn't
  // answering or while its last is out; a refusal is kept to say it, and the
  // switch itself moves only on fieldd's next snapshot (the P5 law). MK-5b: a
  // refusal read as it lands, for Try again's two requests, said by the one
  // fieldd refused.
  const run = useCallback(
    (key: string, refusal: Refusal | (() => Refusal), ask: () => Promise<void>) => {
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
          (error: unknown) => {
            const said = typeof refusal === "function" ? refusal() : refusal;
            setRefused((was) =>
              new Map(was).set(
                key,
                refusedWhileUpdating(error) ? { ...said, updating: true } : said,
              ),
            );
          },
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
  // MK-5b (§8 "Installed", MK-5b's drawing): Try again on a row that offers it (`retry`) turns its plugin off and
  // on — the switch's two requests, in turn, under the switch's own key, so neither takes a press until both are
  // answered, and it stands meanwhile (`retrying`). A refusal is the switch's, said by the request fieldd refused:
  // off, or on. The keyboard stays in the field, as an Install's: the press takes no second press while it runs.
  const onRetry = useCallback(
    (id: string) => {
      if (installed?.find((row) => row.id === id)?.retry !== true) return;
      let turningOn = false;
      run(switchKey.one(id), () => ({ id, capability: null, turningOn }), async () => {
        setRetrying((was) => new Set(was).add(id));
        try {
          await port.disable(id);
          turningOn = true;
          await port.enable(id);
        } finally {
          setRetrying((was) => {
            const next = new Set(was);
            next.delete(id);
            return next;
          });
        }
      });
      if (takeFocus) inputRef.current?.focus({ preventScroll: true });
    },
    [installed, run, port, takeFocus],
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

  // The hot row, Discover's hot tile (MK-4e) or (MK-UC) Updates' hot row stays in sight as the keys walk it (as
  // the Peek's does).
  useEffect(() => {
    if (!open || page !== null) return;
    const row = listRef.current?.querySelector<HTMLElement>('[data-hot="true"]');
    if (row !== null && row !== undefined && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [open, page, tab, hotAt]);

  // The field holds the keys (a row or a tile is no stop of Tab): on Installed ↑ ↓ walk the hot row; on
  // Discover's shelf ↑ ↓ walk the tiles a row at a time and ← → one at a time while the field holds no words
  // (MK-4e; once it holds any, they move the caret); ↵ opens the hot one's page, or (O2-C) presses the foot's
  // Install for a hot tile this desktop doesn't have. ↵ presses Show installed on Discover's no-registry state,
  // and on a page (O2-C) its act: Install, Try again or the card's Install. A button keeps its own Return.
  // MK-UC's UC-C: on Updates ↑ ↓ walk its rows, and ↵ presses the hot row's act (Update, or Try again), or a card's
  // Update while one stands.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (page !== null) {
        if (event.key !== "Enter" || event.target instanceof HTMLButtonElement) return;
        if (pressAct()) event.preventDefault();
        return;
      }
      const key = event.key;
      // MK-5b: where neither door answered, ↵ presses Try again, on Discover and on Updates
      if (tryAgain !== null && key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        if (!away) tryAgain();
        return;
      }
      if (tab === "updates") {
        const list = updateList ?? [];
        if (key === "ArrowDown" || key === "ArrowUp") {
          if (event.target !== inputRef.current || list.length === 0) return;
          event.preventDefault();
          setHot((at) => walkHot(Math.min(at, list.length - 1), key, list.length));
          return;
        }
        if (key !== "Enter" || event.target instanceof HTMLButtonElement) return;
        if (updateNow.current?.at.step === "card") {
          event.preventDefault();
          confirmUpdate();
          return;
        }
        const row = list[hotAt];
        const rowNow = row === undefined ? undefined : rowActs.get(row.id);
        const pressable =
          rowNow !== undefined &&
          (rowNow.kind === "update" || rowNow.kind === "failed") &&
          rowNow.live;
        if (row !== undefined && pressable) {
          event.preventDefault();
          startUpdate(row.id, "row", false);
        }
        return;
      }
      const rows = tab === "installed" && installed !== null ? installed : [];
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
      if (installHot !== null) {
        event.preventDefault();
        installHot();
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
      pressAct,
      installHot,
      updateList,
      rowActs,
      confirmUpdate,
      startUpdate,
      tryAgain,
      away,
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
      categories={categories}
      category={shownCategory}
      onCategory={onCategory}
      onCategoryPressed={onCategoryPressed}
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
      pageAct={
        shown !== null && act !== null ? (
          <PageActView
            act={act}
            onShow={showOnBoard}
            onInstall={
              pageUpdate !== null
                ? () => startUpdate(shown.id, "page", false)
                : () => install(shown.id)
            }
            onConfirm={pageUpdate !== null ? confirmUpdate : confirm}
            onCancel={pageUpdate !== null ? cancelUpdate : cancelInstall}
            onGoOn={goOn}
            takeFocus={takeFocus}
          />
        ) : null
      }
      updatesList={
        updateList === null || catalog === null ? null : (
          <PluginsUpdates
            head={updatesHead(updatesAll ?? updateList, catalog, now())}
            all={updateAllAct(updateList, busy, catalog.state, away)}
            rows={updateList}
            acts={rowActs}
            hot={hotAt}
            listRef={listRef}
            onAll={onAll}
            onOpen={openPage}
            onUpdate={(id) => startUpdate(id, "row", false)}
            onConfirm={confirmUpdate}
            onCancel={cancelUpdate}
          />
        )
      }
      onCheckAgain={tab === "updates" && page === null && updateList !== null ? checkAgain : null}
      checking={reading}
      pageRemove={
        removeShown !== undefined ? (
          <RemoveView
            question={
              removeAsking === null
                ? null
                : removeQuestion(removeShown, removeAsking.step, removeAsking.roster, onMac)
            }
            sending={removeAsking?.sending === true}
            refused={removeRefused === removeShown.id}
            live={!away}
            takeFocus={takeFocus}
            onAsk={() => askRemove(removeShown.id)}
            onFurther={askRemoveData}
            onConfirm={confirmRemove}
            onCancel={cancelRemove}
          />
        ) : null
      }
      onInstallHot={installHot}
      pageFrom={page?.from ?? tab}
      updates={updates}
      away={away}
      under={under}
      refused={refused}
      onTurn={onTurn}
      onTurnPower={onTurnPower}
      onRetry={onRetry}
      onTryAgain={tryAgain}
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

/** MK-5b: no plugin's runtime read as failed. */
const NO_FAILURES: ReadonlySet<string> = new Set<string>();

/** Two reads of failed runtimes that name the same plugins. */
function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** MK-5b: the plugins whose runtime fieldd says failed (`runtimeFailures`), read over the feed
 * Settings → Diagnostics' Plugins section reads (`plugins.runtime.subscribe`; one wire
 * subscription between them, item 467) and handed up. The frame mounts it while the popup stands,
 * so folding lets the read go. A read not answered yet, refused, or one this window can't parse
 * reads as none failed: the rows then say what the registry says, never a guess. So does a read
 * the client ended, whose last data it keeps beside the error, never as live again
 * (`useSubscription`): only a live read is read. */
function RuntimeRead({ onRead }: { onRead: (failed: ReadonlySet<string>) => void }): null {
  const runtime = useSubscription<unknown>("plugins.runtime.subscribe", {});
  useEffect(() => {
    if (runtime.status !== "live") {
      onRead(NO_FAILURES);
      return;
    }
    const parsed = PluginRuntimeDiagnosticsSnapshot.safeParse(runtime.data);
    onRead(parsed.success ? runtimeFailures(parsed.data) : NO_FAILURES);
  }, [runtime.status, runtime.data, onRead]);
  // the popup folded: nothing is read as failed
  useEffect(() => () => onRead(NO_FAILURES), [onRead]);
  return null;
}

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
 * desktop's statement mark over fieldd's two doors for it (MK-O1 B). Item 476:
 * and the window's own set of plugins that cannot start in it, read from its
 * store as the snapshot is. MK-5b: and, while the popup stands, the plugins
 * whose runtime fieldd says failed (`RuntimeRead`). Item 433: Discover opens on
 * the category its door asked for (`openCategory`: the pegboard's More in
 * Plugins… hands the board's; `""` All from every other door), never on a
 * note's opening. */
export function FramePlugins({
  view,
  surface,
  onSurfaceChange,
  openOn = "discover",
  openCategory = "",
  onMac = false,
}: {
  view: FrameView;
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  openOn?: PluginsTab;
  openCategory?: string;
  onMac?: boolean;
}): ReactElement | null {
  const fieldd = useFielddClient();
  const port = useMemo(() => pluginsPortOver(fieldd), [fieldd]);
  const snapshot = usePluginRegistrySnapshot();
  const unstarted = useUnstartedPlugins();
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
  // MK-UC's UC-C (MK-E6): the note an install or an update kept as the window came back fresh, read once as the
  // frame first mounts. The popup opens on it once — on its page, or on Updates for Update all — and every later
  // opening is a door's.
  const [carried, setCarried] = useState<PluginsCarry | null>(() => takeCarry());
  const carriedOpened = useRef(false);
  // MK-5b: the plugins whose runtime fieldd says failed, read while the popup stands; a read that
  // names the same plugins changes nothing
  const [failed, setFailed] = useState<ReadonlySet<string>>(NO_FAILURES);
  const takeFailed = useCallback(
    (next: ReadonlySet<string>) => setFailed((was) => (sameIds(was, next) ? was : next)),
    [],
  );
  useEffect(() => {
    if (carried === null) return;
    if (surface === "plugins") {
      carriedOpened.current = true;
      return;
    }
    if (carriedOpened.current) setCarried(null);
    else onSurfaceChange("plugins");
  }, [carried, surface, onSurfaceChange]);
  return (
    <>
      {surface === "plugins" && <RuntimeRead onRead={takeFailed} />}
      <Plugins
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        port={port}
        snapshot={snapshot}
        unstarted={unstarted}
        failed={failed}
        initialTab={carried === null ? openOn : (carried.page?.from ?? "updates")}
        initialCategory={carried === null ? openCategory : ""}
        initialPage={carried?.page?.id ?? null}
        resume={carried}
        holdKeys={view === "godview" ? godview?.holdKeys : undefined}
        onCatalog={takeCount}
        updates={updates}
        onMac={onMac}
        away={away}
        community={community}
        onCommunity={onCommunity}
        statement={statement}
      />
    </>
  );
}
