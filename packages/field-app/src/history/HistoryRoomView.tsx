import {
  HistoryRoom,
  type HistoryRoomHandle,
  type KeyValueStore,
  type RoomPorts,
  type RoomSelection,
  type RoomTarget,
} from "@rosetta/room";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { EmptyState } from "@vibefield/design-kit/primitives";
import {
  type CSSProperties,
  type ReactElement,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { COVER_EDGE_CLEAR_PX, COVER_RESERVE_PX, HEAD_BAND_PX } from "../frame/frame-geometry";
import type { HistorySearchSheet } from "./search";
// The room's own sheet enters HERE, with the room — one row, the package's own
// bundle, never a copy — so it rides the room's chunk, not the first paint, and
// lands after the kit's tokens by load order (its README's one ordering rule).
import "@rosetta/room/styles/room.css";
import "./history-room-view.css";
// DK-15: on the desk the room's fades are the cover's tint, never frost — in the room's own chunk, after its sheet
import "./history-room-glass.css";

// THE HISTORY VIEW (AR-8c; DESIGN.md §8 "History", §10; One Frame §9 "History,
// joined" — FC-D6, FC-D15, FC-D16): rosetta's room, the package, on the cover's
// glass. Controller-free — the room's four ports arrive as props, so the
// catalog mounts THIS composition over the package's fixture ports and the
// product mounts it over fieldd's (`HistoryView.tsx`). What it owns is the
// room's place in the frame: the glass (the room paints no ground of its own
// on a host surface, and its paper fades are the cover's tint, never frost —
// `history-room-glass.css`, DK-15), the
// edges (its columns end at the reserve, its top band is the head's, 8 px stay
// clear at each side for the notches' slivers), where its dialogs land (a
// layer that ends at the reserve, so a dialog never sits under the line, and
// since the search interim starts at the head band's foot, so the sheet and a
// dialog never cover the band), the prefix it keeps its preferences under, the
// words of its two honest states that are the host's to say, and — until the
// Peek lands — its search: the room's own sheet with the host's open state,
// no key printed, and the empty transcript in VibeField's words
// (`search.ts`; DESIGN.md §8 "History"). The product reaches this module only
// through the room's chunk (`room-chunk.tsx`, 2026-10-04), the catalog
// directly; nothing else imports it statically.

/** Every name the room keeps in storage goes under this prefix (recent
 * searches, dealt project tints, the site-icon setting, the fold). */
export const HISTORY_STORAGE_PREFIX = "vf.history.";

/** The window's localStorage behind a guard: a store that refuses (a private
 * window, a blocked origin, a full disk) costs the memory, never the room. */
export function guardedLocalStorage(): KeyValueStore | null {
  let store: Storage;
  try {
    store = window.localStorage;
  } catch {
    return null;
  }
  return {
    getItem(key) {
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        store.setItem(key, value);
      } catch {
        // refused: the preference holds for this run only
      }
    },
  };
}

/** The empty transcript's sentence while the room's search is shown (the
 * search interim; DESIGN.md §8 "History"). The room's own would name ⌘K, which
 * is the palette's here — so VibeField says where the search is instead. */
export const HISTORY_EMPTY_PROMPT = "Pick a session, or search above.";

/** What the room shows while the index waits for consent to read anything:
 * consent is the enrollment, and it is given in Settings (AR-1). */
export function HistoryConsentState(): ReactElement {
  return (
    <div className="vf-history-state">
      <EmptyState
        visual={<FieldGlyph name="history" size={28} />}
        title="No agent's history is read yet"
        description="Nothing is enrolled yet, so the index reads nothing. Choose whose history it reads in Settings → Agents."
      />
    </div>
  );
}

export interface HistoryRoomViewProps {
  /** The room's ports: fieldd's in the product, the package's fixtures in the
   * catalog. */
  ports: RoomPorts;
  /** The index's state in the frame's words, said under the room's own
   * "rosettad is not answering" when the catalog cannot answer. */
  unavailable?: string | null;
  /** The chosen session, on mount and on every change — Resume's subject. */
  onSelect?: ((selection: RoomSelection | null) => void) | undefined;
  /** Open the room at a session (and a message): each new target is one
   * `openAt` on the room's handle — the seam the frame's Peek will open a
   * hit through (GV-D8…D10), and the catalog's chosen-session plate today. */
  openAt?: RoomTarget | null;
  /** Where the room keeps its preferences; the window's guarded
   * localStorage when absent, nothing kept when null. */
  storage?: KeyValueStore | null;
  /** The room's own search — its strip's launcher and its sheet — until the
   * Peek lands (the search interim): the open state is the host's, the frame's
   * one value in the product (`search.ts`). Absent or null: no launcher, no
   * sheet, and the room's own empty-transcript sentence. */
  search?: HistorySearchSheet | null;
  /** Where the room's handle is kept for the host's keys (⌘G / ⇧⌘G walk the
   * stepper, `search.ts`); the view keeps its own when absent. */
  roomRef?: RefObject<HistoryRoomHandle | null>;
}

export function HistoryRoomView({
  ports,
  unavailable = null,
  onSelect,
  openAt = null,
  storage,
  search = null,
  roomRef,
}: HistoryRoomViewProps): ReactElement {
  const [layers, setLayers] = useState<HTMLDivElement | null>(null);
  // An object ref, not a ref callback: the room's handle type is declared in
  // the package's own React types, and an object ref is the one form both
  // installs agree on structurally. The host's, when it keeps one for its keys.
  const ownRoom = useRef<HistoryRoomHandle | null>(null);
  const room = roomRef ?? ownRoom;
  useEffect(() => {
    if (openAt !== null) room.current?.openAt(openAt);
  }, [openAt, room]);
  // The room's search as VibeField hosts it (RO-14): the open state is the
  // host's, and NO key is printed — ⌘K is the palette's and nothing else is
  // spent on opening the sheet — so the launcher opens it with a press.
  const searchOpen = search?.open ?? false;
  const onSearchOpenChange = search?.onOpenChange ?? null;
  const initialQuery = search?.initialQuery;
  const roomSearch = useMemo(
    () =>
      onSearchOpenChange === null
        ? undefined
        : { open: searchOpen, onOpenChange: onSearchOpenChange, initialQuery, shortcut: null },
    [searchOpen, onSearchOpenChange, initialQuery],
  );
  const [store] = useState<KeyValueStore | null>(() =>
    storage === undefined ? guardedLocalStorage() : storage,
  );
  return (
    <div
      className="vf-history"
      style={
        {
          "--vf-history-reserve": `${COVER_RESERVE_PX}px`,
          "--vf-history-head": `${HEAD_BAND_PX}px`,
        } as CSSProperties
      }
    >
      <div className="vf-history-room">
        <HistoryRoom
          ref={room}
          catalog={ports.catalog}
          sessions={ports.sessions}
          assets={ports.assets}
          host={ports.host ?? null}
          surface="host"
          edgeInset={{ top: HEAD_BAND_PX, right: COVER_EDGE_CLEAR_PX, left: COVER_EDGE_CLEAR_PX }}
          portalContainer={layers}
          storagePrefix={HISTORY_STORAGE_PREFIX}
          storage={store}
          unavailable={unavailable}
          consent={<HistoryConsentState />}
          search={roomSearch}
          emptyPrompt={roomSearch === undefined ? undefined : HISTORY_EMPTY_PROMPT}
          onSelect={onSelect}
        />
      </div>
      <div className="vf-history-layers" ref={setLayers} />
    </div>
  );
}
