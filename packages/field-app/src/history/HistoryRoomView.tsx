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
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { COVER_RESERVE_PX, HEAD_BAND_PX } from "../frame/frame-geometry";
import { type ViewKeys, viewKeysOf } from "../frame/views";
// HG-2: History before its past — the view's own layer over the room while it waits for consent
import { HistoryConsentMarker, HistoryGlass } from "./HistoryGlass";
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
// edges (its columns end at the reserve and run to the window's sides, and its
// top band is the head's — the 8 px it kept clear at each side for the notches'
// slivers left with the edges at HN-8), where its dialogs land (a
// layer that ends at the reserve, so a dialog never sits under the line, and
// starts at the head band's foot, so a dialog never covers the band or the
// frame's search button in it), the prefix it keeps its preferences under, the
// words of its two honest states that are the host's to say (their titles too,
// since rosetta 0.1.3), where it opens
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

/** The titles of the room's disconnected face, in VibeField's words (DESIGN.md
 * §8 "History", §9 "The agents' words": the daemon is never named on screen).
 * Rosetta 0.1.3 lets the host title it (RO-28, rosetta#27); until then the room
 * said "rosettad is not answering" and "Connecting to rosettad". Reaching the
 * index says what the chunk's own face said before it (`HistoryOpening.tsx`),
 * so History's open reads as one state; the reader's closed face is the
 * room's. The line under them stays the frame's (`unavailable`). */
export const HISTORY_UNAVAILABLE_TITLE = "History isn't answering";
export const HISTORY_CONNECTING_TITLE = "Opening History…";

export interface HistoryRoomViewProps {
  /** The room's ports: fieldd's in the product, the package's fixtures in the
   * catalog. */
  ports: RoomPorts;
  /** The index's state in the frame's words, said under the room's own
   * "History isn't answering" when the catalog cannot answer. */
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
  /** fix7 — the frame's own acts over the room: the index's restart under it
   * while it has failed (`index-restart.tsx`), and AO-6b's new agent with a past
   * at its head (`NewAgentPast.tsx`). VibeField's, not the room's. */
  act?: ReactNode;
  /** AO-3 (AO-D9) — what the room shows while the index waits for consent to
   * read anything: the History pane itself, "Bring in your past sessions.",
   * from the controller. It replaces a dead end that pointed at a Settings page
   * with no such control. Absent (a catalog with no daemon), the room's own
   * words. *HG-2 (2026-11-08; DESIGN.md §8 "History" — before its past):* it
   * is a card now, and the view stands it in its own layer over the sample
   * room (`HistoryGlass.tsx`) while the room's slot holds a marker. */
  consent?: ReactNode;
  /** HG-2 — History is the view shown, so the room behind glass develops each
   * time it shows (DESIGN.md §6); shown when absent, as the catalog's plates are. */
  shown?: boolean;
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
  act = null,
  consent,
  shown = true,
}: HistoryRoomViewProps): ReactElement {
  const [layers, setLayers] = useState<HTMLDivElement | null>(null);
  // HG-2: the room's consent slot holds a marker, and the view draws the card
  // behind glass in its own layer while the marker stands (`HistoryGlass.tsx`).
  const card = consent === undefined || consent === null || consent === false ? null : consent;
  const [waiting, setWaiting] = useState(false);
  const [marker] = useState(() => <HistoryConsentMarker onWaiting={setWaiting} />);
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
          edgeInset={{ top: HEAD_BAND_PX }}
          portalContainer={layers}
          storagePrefix={HISTORY_STORAGE_PREFIX}
          storage={store}
          unavailable={unavailable}
          unavailableTitle={HISTORY_UNAVAILABLE_TITLE}
          connectingTitle={HISTORY_CONNECTING_TITLE}
          consent={card === null ? consent : marker}
          emptyPrompt={emptyPrompt}
          onSelect={onSelect}
          {...inputs}
        />
      </div>
      {card !== null && (
        <HistoryGlass waiting={waiting} shown={shown}>
          {card}
        </HistoryGlass>
      )}
      {act}
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
        unavailableTitle={HISTORY_UNAVAILABLE_TITLE}
      />
    </div>
  );
}
