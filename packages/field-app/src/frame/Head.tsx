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
import type { SyncPosture } from "../account/posture";
import { earlierFields, type SyncQuestionDoor } from "../account/sync-question";
import { emitZoomKeyMarker, emitZoomMenuMarker } from "../development-console";
import type { DocManagerApi } from "../doc-manager";
import { useDocSyncStatuses } from "../doc-sync-store";
import { relativeTime } from "../format/relative-time";
import { PluginSurfaceHost, useVisiblePluginSurfaces } from "../hud/PluginSurfaceSlot";
import { getRendererLogger } from "../logging";
import { usePluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";
import { type FrameSurface, foldSurface, type SheetShelf, sheetShelf } from "./frame-surface";
import { type HeadArtifacts, type HeadDocTile, type HeadDot, HeadView } from "./HeadView";
import { hubWaits, useArtifactsDot } from "./head-artifacts";
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
// place, the explorer's acts, the zoom's menu and its keys, and since HN-8 the
// sheet's two shelves and the Hub its Artifacts shelf hosts — and nothing it
// shows, which is `HeadView`'s. Which of the frame's surfaces is open is NOT
// its own: that has one owner (FieldView, `frame-surface.ts`), and this asks
// it. What it reads comes through two doors — the document manager (the
// field, the fields) and the head's canvas door (the path, the zoom) — so the
// catalog runs this exact controller on fixtures; the package's dot
// (`head-artifacts.ts`) and the Hub's binding (the plugin surfaces) are the
// window's own stores, which a catalog without a daemon reads empty.

/** The sheet's fold back into the pill or the circle (§8: 600ms on the island
 * curve): a shelf's contents stay through it, so it never folds away empty. */
const SHEET_FOLD_MS = 600;

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
  /** TS-6 (TS-D13) — the sync question's door: while a link owes it, New field
   * asks it before the field is made. Absent where the head has no daemon (the
   * catalog, its own tests): New field never asks. */
  syncQuestion?: SyncQuestionDoor | undefined;
  /** HN-8 — the window the Hub's surface is hosted for on the Artifacts shelf
   * (the side panel's slot, as the right edge's drawer hosted it). */
  windowId: string;
}

/** The question while it is open: the posture chosen, the fields added. */
interface Asking {
  choice: SyncPosture;
  added: ReadonlySet<string>;
}

/** The shelf the sheet shows (HN-8), or null while it is shut: the owner's, in
 * the view that opened it. A change of view folds the sheet — the line asks
 * the owner, in an effect — and until the owner hears, the sheet is drawn shut,
 * so it never starts to grow over the next view for the frame between. Under a
 * cover it shows Artifacts alone: Fields are the desk's and stay with the pill. */
function useShownShelf(surface: FrameSurface | null, view: FrameView): SheetShelf | null {
  const shelf = sheetShelf(surface);
  const [opened, setOpened] = useState({ shelf, view });
  if (opened.shelf !== shelf) setOpened({ shelf, view });
  if (shelf === null || opened.view !== view) return null;
  return view !== "canvas" && shelf === "fields" ? null : shelf;
}

/** True while `on`, and for `ms` after it goes off: what a fold carries away. */
function useLingering(on: boolean, ms: number): boolean {
  const [lingering, setLingering] = useState(on);
  if (on && !lingering) setLingering(true);
  useEffect(() => {
    if (on) return;
    const timer = window.setTimeout(() => setLingering(false), ms);
    return () => window.clearTimeout(timer);
  }, [on, ms]);
  return on || lingering;
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
  syncQuestion,
  windowId,
}: HeadProps): ReactElement {
  const state = useSyncExternalStore(manager.subscribe, manager.getState);
  const path = useSyncExternalStore(canvas.subscribePath, canvas.path, canvas.path);
  const percent = useSyncExternalStore(canvas.subscribePercent, canvas.percent, canvas.percent);
  // C6-4 — per-field sync standing (absent: sync has nothing to say).
  const syncStatuses = useDocSyncStatuses() ?? [];
  const busy = state.phase === "loading";
  // HN-8 — the pill's sheet is ONE surface on two shelves (PL-D1): which shows.
  const shelf = useShownShelf(surface, view);
  const fieldsOpen = shelf === "fields";
  const zoomOpen = surface === "zoom";
  // PL-D1 — the package's standing dot, read from the catalog by the head itself.
  const packageDot = useArtifactsDot();
  // The Hub the Artifacts shelf hosts — the side panel's one contribution — and,
  // while none is bound, whether its plugin is off or starting.
  const hub = useVisiblePluginSurfaces("hud.side-panel")[0] ?? null;
  const registry = usePluginRegistrySnapshot();
  const artifactsHeld = useLingering(shelf === "artifacts", SHEET_FOLD_MS);
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

  // TS-6 (TS-D13) — the sync question, while New field waits on it. It closes
  // with the explorer, and when nothing owes it any more (answered elsewhere).
  const [asking, setAsking] = useState<Asking | null>(null);
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const owed = syncQuestion?.owed === true;
  useEffect(() => {
    if (!fieldsOpen || !owed) setAsking(null);
  }, [fieldsOpen, owed]);

  const newField = useCallback(() => {
    if (syncQuestion?.owed) {
      setAnswerError(null);
      setAsking({ choice: syncQuestion.posture.posture, added: new Set() });
      return;
    }
    fold("fields");
    void manager.createDoc();
  }, [fold, manager, syncQuestion]);

  /** The answer, in its order: the fields added are sent (the head's own act,
   * so their tiles flip), then the posture and the question's retiring, then
   * the field is made. A refused write keeps the question, in its words. */
  const answerQuestion = useCallback(async () => {
    if (asking === null || syncQuestion === undefined) return;
    setAnswering(true);
    setAnswerError(null);
    try {
      for (const docId of asking.added) await manager.setSyncIntent(docId, "sync");
      if (!(await syncQuestion.answer(asking.choice))) return;
      setAsking(null);
      fold("fields");
      void manager.createDoc();
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : String(error));
      getRendererLogger()
        .child({ component: "docs.head" })
        .error("renderer.sync_question.answer_failed", "The sync question's answer failed", error);
    } finally {
      setAnswering(false);
    }
  }, [asking, fold, manager, syncQuestion]);

  // A fresh registry every time the explorer opens: never a stale catalog.
  useEffect(() => {
    if (fieldsOpen) void manager.refreshDocs().catch(() => {});
  }, [fieldsOpen, manager]);

  // What held the keyboard as a shelf came to show — the button that opened the
  // sheet or turned it, or under a cover the circle — for Esc to give it back.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const focused = document.activeElement;
    opener.current = shelf !== null && focused instanceof HTMLElement ? focused : null;
  }, [shelf]);

  // Esc shuts the sheet, on either shelf — on the capture phase, so the canvas
  // keymap's Esc (which would go up a folder) and a covered view's own never
  // also fire; a rename keeps its own — and, if the keyboard was in the sheet,
  // gives it back to the button that opened it (DESIGN.md §8 "Artifacts").
  useEffect(() => {
    if (shelf === null) return;
    const onEsc = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape" || event.target === renameRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const focused = document.activeElement;
      const inside = focused instanceof Element && focused.closest("[data-head-sheet]") !== null;
      fold(shelf);
      if (inside) opener.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [shelf, fold]);

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
          caption: `${relativeTime(entry.updatedAt)}${word === null ? "" : ` · ${word}`}`,
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

  // The Artifacts shelf's contents while it shows, and through its fold: the Hub,
  // hosted for this window — its own close shuts the sheet — or why there is none.
  // An open shelf stays open through the Hub's restart and never folds on an
  // unbind (DESIGN.md §8 "Artifacts"): it waits in words until the Hub is back.
  const artifacts: HeadArtifacts | null = !artifactsHeld
    ? null
    : hub === null
      ? { state: hubWaits(registry) }
      : {
          state: "hub",
          hub: (
            <PluginSurfaceHost
              slot="hud.side-panel"
              windowId={windowId}
              requestClose={() => fold("artifacts")}
              surfaceId={hub.surfaceId}
            />
          ),
        };

  return (
    <HeadView
      covered={view !== "canvas"}
      place={{
        name: held !== undefined ? IN_MEMORY_NAME : (state.doc?.name ?? "…"),
        path,
        dot: held !== undefined ? heldDot(held) : current === undefined ? null : syncDot(current),
        renaming,
        renameRef,
        shelf,
        busy,
        docs,
        currentId,
        // The button that is on shuts the sheet; the other opens it on its shelf,
        // or turns it there in place — one surface, so turning folds nothing.
        onShelf: (next) => {
          if (next !== null) onSurfaceChange(next);
          else if (shelf !== null) fold(shelf);
        },
        packageDot,
        artifacts,
        onJump: (depth) => canvas.exitTo(depth),
        onRename: beginRename,
        onRenameDraft: setRenaming,
        onRenameEnd: endRename,
        onOpenDoc: (docId) => {
          fold("fields");
          if (docId !== currentId) void manager.switchTo(docId);
        },
        onNewField: newField,
        onToggleSync: toggleSync,
        onDeleteDoc: deleteDoc,
        question:
          asking === null || syncQuestion === undefined
            ? null
            : {
                choice: asking.choice,
                locked: answering || syncQuestion.posture.unavailable,
                earlier: earlierFields(state.docs)
                  .filter((entry) => !(state.beforeTheDesk ?? []).includes(entry.docId))
                  .map((entry) => ({
                    docId: entry.docId,
                    name: entry.name,
                    caption: relativeTime(entry.updatedAt),
                  })),
                added: asking.added,
                error: answerError ?? syncQuestion.posture.writeError,
                onChoose: (choice) => setAsking((open) => open && { ...open, choice }),
                onToggle: (docId) =>
                  setAsking((open) => {
                    if (open === null) return null;
                    const added = new Set(open.added);
                    if (!added.delete(docId)) added.add(docId);
                    return { ...open, added };
                  }),
                onAnswer: () => void answerQuestion(),
                onCancel: () => setAsking(null),
              },
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
