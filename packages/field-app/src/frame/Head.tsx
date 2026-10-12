import { isEditableTarget, keyboardClaimOf } from "@vibecook/ice/dom";
import type {
  DocRegistryEntry,
  DocSyncStatus,
  FrameView,
  FrameZoomAct,
} from "@vibefield/contracts";
import {
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { emitZoomKeyMarker, emitZoomMenuMarker } from "../development-console";
import type { DocManagerApi } from "../doc-manager";
import { useDocSyncStatuses } from "../doc-sync-store";
import { getRendererLogger } from "../logging";
import { type FrameSurface, foldSurface } from "./frame-surface";
import { type HeadDocTile, type HeadDot, HeadView } from "./HeadView";
import type { HeadCanvas } from "./head-canvas";
import type { ViewKeys } from "./views";
import {
  runZoom,
  ZOOM_ACTS,
  type ZoomAct,
  zoomActAvailable,
  zoomActForKey,
  zoomKeyLabel,
} from "./zoom";

// THE HEAD'S CONTROLLER (DESIGN.md §8 "The head", §10; One Frame FR-3). It
// owns what the head DOES — the field's name and the path to read, renaming in
// place, the explorer's acts, the zoom's menu and its keys — and nothing it
// shows, which is `HeadView`'s. Which of the frame's surfaces is open is NOT
// its own: that has one owner (FieldView, `frame-surface.ts`), and this asks
// it. What it reads comes through two doors — the document manager (the
// field, the fields) and the head's canvas door (the path, the zoom) — so the
// catalog runs this exact controller on fixtures.

/** "2h ago": a field's time, as its tile says it. */
function fmtRelative(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** C6-4 — the pill's sync dot says STANDING states only (pending, a peer
 * offline, declined, epoch-stale): transient syncing lives in Settings and the
 * tiles, so the head never flickers with routine traffic. Muted for a fact,
 * orange where something needs attention (§2.5 — nothing failed, so never
 * red); the title carries the words and the numbers. */
export function syncDot(status: DocSyncStatus): HeadDot | null {
  const at = status.peers.reduce<number | null>(
    (last, p) =>
      p.lastExchangeAt !== null && (last === null || p.lastExchangeAt > last)
        ? p.lastExchangeAt
        : last,
    null,
  );
  const when =
    at !== null ? ` — last exchange ${new Date(at).toLocaleTimeString()}` : " — no exchange yet";
  switch (status.state) {
    case "pending":
      return {
        tone: "muted",
        title: `Waiting on ${status.pendingRecords} record${status.pendingRecords === 1 ? "" : "s"} from a peer${when}`,
      };
    case "peer-offline":
      // Honest about the window (F-C6-22): the last exchange, never promptness.
      return {
        tone: "muted",
        title: `A peer is offline — not everything here has reached it${when}`,
      };
    case "peer-declined":
      return {
        tone: "attention",
        title: `A peer's records were declined (${status.reason ?? "unknown"}) — devices may differ${when}`,
      };
    case "epoch-stale":
      return {
        tone: "attention",
        title: `Parted from a peer by compaction — it must re-bootstrap${when}`,
      };
    default:
      return null; // in step, and syncing: the pill stays quiet
  }
}

/** DK-9 — the pill IN ANOTHER WINDOW'S PLACE: the board this window asked for (its own) is held by
 * another window, so it shows an in-memory board that saves nothing. The pill's name says "In memory"
 * and this dot, in attention (§2.5 — nothing failed), says whose place it stands in. */
export const IN_MEMORY_NAME = "In memory";
export function heldDot(held: { readonly name: string }): HeadDot {
  return {
    tone: "attention",
    title: `“${held.name}” is open in another window — this window's board is in memory and saves nothing`,
  };
}

/** A tile's sync word; null when there is nothing worth a word. */
function syncCaption(status: DocSyncStatus | undefined): string | null {
  if (status === undefined || status.state === "in-step") return null;
  if (status.state === "syncing") return "syncing";
  if (status.state === "pending") return `waiting on ${status.pendingRecords}`;
  if (status.state === "peer-offline") return "peer offline";
  if (status.state === "peer-declined") return "declined";
  return "epoch stale";
}

export interface HeadProps {
  manager: DocManagerApi;
  canvas: HeadCanvas;
  /** The window's view: the zoom is Canvas's instrument, and so are its keys. */
  view: FrameView;
  keys: ViewKeys;
  /** The frame's open surface, from its one owner. */
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  /** Whether the head binds the zoom's keys on the window. The catalog's live
   * head does not: its page is not a window the head owns. */
  bindKeys?: boolean;
  /** The View menu's Actual Size, Zoom In and Zoom Out (FR-4, 3b): main sends
   * the item's ACT through this door, and the head answers it as it answers
   * the keys. Absent where there is no menu bar (the catalog). */
  menuZoom?: (handler: (act: FrameZoomAct) => void) => () => void;
}

export function Head({
  manager,
  canvas,
  view,
  keys,
  surface,
  onSurfaceChange,
  bindKeys = true,
  menuZoom,
}: HeadProps): ReactElement {
  const state = useSyncExternalStore(manager.subscribe, manager.getState);
  const path = useSyncExternalStore(canvas.subscribePath, canvas.path, canvas.path);
  const percent = useSyncExternalStore(canvas.subscribePercent, canvas.percent, canvas.percent);
  // C6-4 — per-field sync standing (absent: sync has nothing to say).
  const syncStatuses = useDocSyncStatuses() ?? [];
  const busy = state.phase === "loading";
  const fieldsOpen = surface === "fields";
  const zoomOpen = surface === "zoom";
  const [renaming, setRenaming] = useState<string | null>(null);
  // Leaving a rename is said twice when Return commits (the input then
  // blurs as it goes); only the first is heard.
  const renamingNow = useRef(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const [hot, setHot] = useState(0);
  const readoutRef = useRef<HTMLButtonElement>(null);

  const fold = useCallback(
    (closing: FrameSurface) => onSurfaceChange(foldSurface(surface, closing)),
    [onSurfaceChange, surface],
  );

  // A fresh registry every time the explorer opens: never a stale catalog.
  useEffect(() => {
    if (fieldsOpen) void manager.refreshDocs().catch(() => {});
  }, [fieldsOpen, manager]);

  // Esc closes the explorer — on the capture phase, so the canvas keymap's
  // Esc (which would go up a folder) never also fires; a rename keeps its own.
  useEffect(() => {
    if (!fieldsOpen) return;
    const onEsc = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape" || event.target instanceof HTMLInputElement) return;
      event.stopPropagation();
      fold("fields");
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [fieldsOpen, fold]);

  // The zoom's menu folds on Esc (the readout takes the keyboard back) and on
  // a press anywhere but the readout and its menu.
  useEffect(() => {
    if (!zoomOpen) return;
    const onEsc = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      fold("zoom");
      readoutRef.current?.focus();
    };
    const onPress = (event: PointerEvent): void => {
      const at = readoutRef.current?.closest("[data-head-zoom]");
      if (
        at !== null &&
        at !== undefined &&
        event.target instanceof Node &&
        at.contains(event.target)
      )
        return;
      fold("zoom");
    };
    window.addEventListener("keydown", onEsc, true);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      window.removeEventListener("keydown", onEsc, true);
      window.removeEventListener("pointerdown", onPress, true);
    };
  }, [zoomOpen, fold]);

  const zoom = useCallback(
    (act: ZoomAct) => {
      fold("zoom");
      runZoom(canvas, act);
    },
    [canvas, fold],
  );

  // ⌘+ ⌘− ⌘0 ⇧1 (DK-D24; DESIGN.md §10) — Canvas's keys, NOT the product's
  // chords: heard on the window's BUBBLE phase, so a pane that holds the
  // keyboard keeps its own ⌘+ ⌘− ⌘0 (ghostty's font sizes are consumed at the
  // pane, and never get here) and a key something else took is left alone.
  // Never under a cover, never from inside a keyboard claim (design-007's
  // marker — the canvas keymap's own gate), and ⇧1 never while typing: it
  // types "!". A key taken is claimed, so the View menu's item never answers
  // it a second time (VIEW_KEYS_ROAD).
  useEffect(() => {
    if (!bindKeys) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.defaultPrevented || view !== "canvas") return;
      const act = zoomActForKey(event, keys);
      if (act === null || keyboardClaimOf(event.target).claimed) return;
      if (act === "fit" && isEditableTarget(event.target)) return;
      event.preventDefault();
      const from = canvas.percent();
      runZoom(canvas, act);
      emitZoomKeyMarker({ key: zoomKeyLabel(act, keys), act, view, from, to: canvas.percent() });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bindKeys, canvas, keys, view]);

  // The View menu's zoom (FR-4, 3b): Electron's page-zoom roles are gone, and
  // each item sends its act here. Canvas's, like the keys: the items are
  // disabled under a cover, and an act that races a change of view lands on a
  // covered view and does nothing.
  useEffect(() => {
    if (menuZoom === undefined) return;
    return menuZoom((act) => {
      if (view !== "canvas") return;
      const from = canvas.percent();
      runZoom(canvas, act);
      emitZoomMenuMarker({ act, view, from, to: canvas.percent() });
    });
  }, [canvas, menuZoom, view]);

  const onReadoutKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const rows = ZOOM_ACTS.length;
      if (!zoomOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setHot(0);
          onSurfaceChange("zoom");
        }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setHot((at) => (at + (event.key === "ArrowDown" ? 1 : rows - 1)) % rows);
      } else if (event.key === "Enter" || event.key === " ") {
        // The hot row is taken; the press never reaches the readout's click.
        event.preventDefault();
        const entry = ZOOM_ACTS[hot];
        if (entry !== undefined) zoom(entry.act);
      } else if (event.key === "Tab") {
        fold("zoom");
      }
    },
    [fold, hot, onSurfaceChange, zoom, zoomOpen],
  );

  const held = state.heldElsewhere;
  const beginRename = useCallback(() => {
    // an in-memory board in another window's place has no name of its own to change (DK-9)
    if (busy || state.doc === null || held !== undefined) return;
    renamingNow.current = true;
    setRenaming(state.doc.name);
  }, [busy, state.doc, held]);

  // Renaming begins where it was asked for: the caret in the name, all of it
  // chosen, so typing replaces it.
  const renameBegun = renaming !== null;
  useEffect(() => {
    if (!renameBegun) return;
    renameRef.current?.focus();
    renameRef.current?.select();
  }, [renameBegun]);

  const endRename = useCallback(
    (commit: boolean) => {
      if (!renamingNow.current) return;
      renamingNow.current = false;
      setRenaming(null);
      const name = (renaming ?? "").trim();
      if (!commit || name.length === 0 || name === state.doc?.name) return;
      void manager
        .rename(name)
        .catch((error: unknown) =>
          getRendererLogger()
            .child({ component: "docs.head", docId: state.doc?.docId })
            .error("renderer.docs.rename_failed", "Document rename failed", error),
        );
    },
    [manager, renaming, state.doc],
  );

  /** UA-D7 — one click, both directions; the manager patches the registry
   * entry it gets back, so the chip flips from the same fact the gates read. */
  const toggleSync = useCallback(
    (entry: DocRegistryEntry) => {
      void manager
        .setSyncIntent(entry.docId, entry.syncIntent === "local" ? "sync" : "local")
        .catch((error: unknown) =>
          getRendererLogger()
            .child({ component: "docs.head", docId: entry.docId })
            .error(
              "renderer.docs.sync_intent_failed",
              "Setting a document's sync intent failed",
              error,
            ),
        );
    },
    [manager],
  );

  const docs = useMemo<HeadDocTile[]>(
    () =>
      state.docs.map((entry) => {
        const word = syncCaption(syncStatuses.find((s) => s.docId === entry.docId));
        const thumbnailUrl = state.thumbnailUrls[entry.docId];
        return {
          entry,
          caption: `${fmtRelative(entry.updatedAt)}${word === null ? "" : ` · ${word}`}`,
          ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
          ...((state.beforeTheDesk ?? []).includes(entry.docId) ? { beforeTheDesk: true } : {}),
        };
      }),
    [state.docs, state.thumbnailUrls, state.beforeTheDesk, syncStatuses],
  );

  /** DS-5's tombstone for a board from before the desk (ruling 7): the library's Delete. */
  const deleteDoc = useCallback(
    (entry: DocRegistryEntry) => {
      void manager
        .deleteDoc?.(entry.docId)
        .catch((error: unknown) =>
          getRendererLogger()
            .child({ component: "docs.head", docId: entry.docId })
            .error("renderer.docs.delete_failed", "Deleting a document failed", error),
        );
    },
    [manager],
  );
  const current = syncStatuses.find((s) => s.docId === state.doc?.docId);
  const currentId = state.doc?.docId ?? null;

  return (
    <HeadView
      covered={view !== "canvas"}
      place={{
        name: held !== undefined ? IN_MEMORY_NAME : (state.doc?.name ?? "…"),
        path,
        dot: held !== undefined ? heldDot(held) : current === undefined ? null : syncDot(current),
        renaming,
        renameRef,
        open: fieldsOpen,
        busy,
        docs,
        currentId,
        onToggle: (open) => onSurfaceChange(open ? "fields" : foldSurface(surface, "fields")),
        onJump: (depth) => canvas.exitTo(depth),
        onRename: beginRename,
        onRenameDraft: setRenaming,
        onRenameEnd: endRename,
        onOpenDoc: (docId) => {
          fold("fields");
          if (docId !== currentId) void manager.switchTo(docId);
        },
        onNewField: () => {
          fold("fields");
          void manager.createDoc();
        },
        onToggleSync: toggleSync,
        onDeleteDoc: deleteDoc,
      }}
      zoom={{
        percent,
        // read with the percent: the camera moved, so the band's ends are asked again
        unavailable: ZOOM_ACTS.map((entry) => entry.act).filter(
          (act) => !zoomActAvailable(act, canvas.zoom(), canvas.bounds?.()),
        ),
        keys,
        open: zoomOpen,
        hot,
        readoutRef,
        onToggle: (open) => {
          setHot(0);
          onSurfaceChange(open ? "zoom" : foldSurface(surface, "zoom"));
        },
        onFit: () => zoom("fit"),
        onAct: zoom,
        onHot: setHot,
        onReadoutKeyDown,
      }}
    />
  );
}
