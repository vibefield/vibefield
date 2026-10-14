import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { EmptyState } from "@vibefield/design-kit/primitives";
import {
  HistoryRoom,
  type HistoryRoomHandle,
  type KeyValueStore,
  type ReaderAddress,
  type RoomHostInputs,
  type RoomPorts,
  type RoomSelection,
  type RoomTarget,
  TranscriptReader,
} from "@vibefield/rosetta-room";
import {
  type CSSProperties,
  type ReactElement,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { COVER_EDGE_CLEAR_PX, COVER_RESERVE_PX, HEAD_BAND_PX } from "../frame/frame-geometry";
import { type ViewKeys, viewKeysOf } from "../frame/views";
// The room's own sheet enters HERE, with the room — one row, the package's own
// bundle, never a copy — so it rides the room's chunk, not the first paint, and
// lands after the kit's tokens by load order (its README's one ordering rule).
import "@vibefield/rosetta-room/styles/room.css";
import "./history-room-view.css";
// PJ-4: VibeField's own content inside the room's host slots
import "./history-host.css";
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
// starts at the head band's foot, so a dialog never covers the band or the
// frame's search button in it), the prefix it keeps its preferences under, the
// words of its two honest states that are the host's to say, where it opens
// (`openAt` — the Peek's picks, 2026-10-08) and the empty transcript in
// VibeField's words, naming the key the frame's search button prints
// (DESIGN.md §8 "History"). The room's own search — its strip's launcher and
// sheet — is not drawn: VibeField's search is the frame's Peek. The product
// reaches this module only through the room's chunk (`room-chunk.tsx`,
// 2026-10-04), the catalog directly; nothing else imports it statically.

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

/** The empty transcript's sentence (K2; DESIGN.md §8 "History"): it names
 * the key the frame's search button prints — the Peek's ⌘F, Ctrl+F off the
 * Mac. (The room's own would name ⌘K, which is the palette's here.) */
export function historyEmptyPrompt(keys: ViewKeys): string {
  return `Pick a session, or search with ${keys === "mac" ? "⌘F" : "Ctrl+F"}.`;
}

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
   * `openAt` on the room's handle — the seam the frame's Peek opens a past
   * row through (GV-D8, `open-at.ts`), and the catalog's chosen-session
   * plate. A fresh object each time, even for the same place. */
  openAt?: RoomTarget | null;
  /** Where the room keeps its preferences; the window's guarded
   * localStorage when absent, nothing kept when null. */
  storage?: KeyValueStore | null;
  /** How the empty transcript names search's key: ⌘F on the Mac, Ctrl+F
   * elsewhere — the host's platform, the page's when absent. */
  keys?: ViewKeys;
  /** Where the room's handle is kept, should the host hold it; the view
   * keeps its own when absent. */
  roomRef?: RefObject<HistoryRoomHandle | null>;
  /** PJ-4 — what VibeField hands the room beyond its ports (rosetta
   * `host-inputs.ts`; `host-inputs.tsx` builds them): projects' colours and
   * marks, the sections, row and head acts, ③'s folders, the chips. Absent:
   * the room as rosetta's app shows it. Memoized by the controller — the room
   * calls them as it renders. */
  inputs?: RoomHostInputs;
}

export function HistoryRoomView({
  ports,
  unavailable = null,
  onSelect,
  openAt = null,
  storage,
  keys,
  roomRef,
  inputs,
}: HistoryRoomViewProps): ReactElement {
  const [layers, setLayers] = useState<HTMLDivElement | null>(null);
  // An object ref, not a ref callback: the room's handle type is declared in
  // the package's own React types, and an object ref is the one form both
  // installs agree on structurally. The host's, when it keeps one.
  const ownRoom = useRef<HistoryRoomHandle | null>(null);
  const room = roomRef ?? ownRoom;
  useEffect(() => {
    if (openAt !== null) room.current?.openAt(openAt);
  }, [openAt, room]);
  const [store] = useState<KeyValueStore | null>(() =>
    storage === undefined ? guardedLocalStorage() : storage,
  );
  const emptyPrompt = historyEmptyPrompt(keys ?? viewKeysOf(undefined));
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
          emptyPrompt={emptyPrompt}
          onSelect={onSelect}
          {...inputs}
        />
      </div>
      <div className="vf-history-layers" ref={setLayers} />
    </div>
  );
}

/** PK3 (James's docket v9; W2 — the swap is pj4's): the Peek's past picture is
 * the room's own read-only reader, landed at the matched line with the
 * query's words marked — K8's one replaceable component, replaced whole. It
 * rides this chunk with the room (it IS the room's code), over the window's
 * History ports, so it reads the room's one meta feed and its session leases.
 * K1: a match stays neutral — the text's own ink at 600 on an 11% wash of it —
 * through the reader's own tokens (`--ah-match`, `--ah-match-weight`, set by
 * `.vf-peek-reader`); the matched line keeps the reader's quiet edge. Never
 * `--vf-select`. Its `at` is
 * read by VALUE (ROOM API v2): a new line lands, the same one does not move. */
export function PeekReaderView({
  ports,
  at,
}: {
  ports: RoomPorts;
  at: ReaderAddress;
}): ReactElement {
  return (
    <div className="vf-peek-reader">
      <TranscriptReader
        catalog={ports.catalog}
        sessions={ports.sessions}
        assets={ports.assets}
        host={ports.host ?? null}
        at={at}
        surface="host"
        storagePrefix={HISTORY_STORAGE_PREFIX}
        storage={null}
      />
    </div>
  );
}
