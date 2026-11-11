import type { FrameView, PluginRegistrySnapshot } from "@vibefield/contracts";
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
import { usePluginRegistrySnapshot } from "../../plugin-host/plugin-registry-store";
import { useGodviewFindDoor } from "../find-door";
import { type FrameSurface, foldSurface } from "../frame-surface";
import { PluginsView } from "./PluginsView";
import {
  catalogFoot,
  installedFoot,
  installedRows,
  type PluginsRead,
  type PluginsTab,
  pluginsLayout,
  shelfState,
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
// reads the registry snapshot the window already holds, read only (MK-4c
// brings its switch and its page). Nothing in the product opens it yet: its
// doors are MK-4b's and MK-4d's. The catalog mounts this controller over a
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
  now?: () => number;
}

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
  now = Date.now,
}: PluginsProps): ReactElement | null {
  const open = surface === "plugins";
  const [tab, setTab] = useState<PluginsTab>(initialTab);
  const [query, setQuery] = useState("");
  const [read, setRead] = useState<PluginsRead>({ kind: "asking" });
  const [reading, setReading] = useState(false);
  const [box, setBox] = useState(() => boxOf(container));
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(null);

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
        if (current && !fresh) setRead({ kind: "answered", catalog });
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

  // While open, Esc is the popup's before anything else hears it (MK-4a has no
  // page or question for it to answer first).
  useEffect(() => {
    if (!open || !bindKeys) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      fold();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, bindKeys, fold]);

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
  const showInstalled = useCallback(() => {
    setTab("installed");
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // ↵ presses the one act on the screen: Show installed, on Discover's
  // no-registry state (a button keeps its own Return).
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      if (event.target instanceof HTMLButtonElement) return;
      if (tab === "discover" && shelf.kind === "unconfigured") {
        event.preventDefault();
        showInstalled();
      }
    },
    [tab, shelf.kind, showInstalled],
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
      inputRef={inputRef}
      onQuery={setQuery}
      onTab={setTab}
      onClose={fold}
      onShowInstalled={showInstalled}
      onKeyDown={onKeyDown}
    />,
    target,
  );
}

/** The popup as the frame holds it (ChromeLayer): over this window's fieldd
 * client and the registry snapshot FieldView feeds, holding Godview's keys
 * while it stands there (QL-D2). */
export function FramePlugins({
  view,
  surface,
  onSurfaceChange,
}: {
  view: FrameView;
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
}): ReactElement | null {
  const fieldd = useFielddClient();
  const port = useMemo(() => pluginsPortOver(fieldd), [fieldd]);
  const snapshot = usePluginRegistrySnapshot();
  const godview = useGodviewFindDoor();
  return (
    <Plugins
      surface={surface}
      onSurfaceChange={onSurfaceChange}
      port={port}
      snapshot={snapshot}
      holdKeys={view === "godview" ? godview?.holdKeys : undefined}
    />
  );
}
