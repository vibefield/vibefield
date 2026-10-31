import type { FrameView } from "@vibefield/contracts";
import {
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { emitLineKeyMarker } from "../development-console";
import { type BoardLineDoor, useBoardLineDoor } from "../field/desk/pegboard/board-door";
import { isNewTerminalChord, listenForProductChord } from "../field/product-chords";
import { type FieldHost, getHost } from "../host";
import { hearTerminalInputRefusals, type RoutedInputRefusal } from "../terminal/pool";
import { ComposerLineView, type LineNote } from "./ComposerLine";
import { noteCapture, useCaptureState } from "./capture-state";
import { installCardsLab } from "./cards/cards-lab";
import { dealCapture } from "./cards/cards-sources";
import type { CardStore } from "./cards/cards-store";
import { CAPTURE_WORDS, captureRefusal } from "./cards/cards-words";
import { isField } from "./cards/caret";
import { type FrameSurface, foldSurface } from "./frame-surface";
import {
  type HistoryLineDoor,
  hearLineSays,
  inputRefusalNote,
  type LineViewDoor,
  newTerminalNote,
  refusalClaimed,
  useGodviewLineDoor,
  useHistoryLineDoor,
  useHistorySaid,
} from "./line-door";
import { SNAPSHOT_NO_DOOR } from "./line-model";
import type { ViewKeys } from "./views";

// THE LINE'S CONTROLLER (DESIGN.md §8 "The line", §10; One Frame FR-2; LN-D1,
// HN-L6). It owns what the line does — the view's create and its key, the
// snapshot, and the note the frame speaks in — and nothing the line shows,
// which is `ComposerLineView`'s. Which of the frame's surfaces is open is NOT
// its own: that has one owner (FieldView, `frame-surface.ts`), and this asks it.
// The draft, @'s list, the mic and send left the line for Chat's thread (LN-D3);
// the frame's note stayed — the outcomes of the line's acts and of acts begun
// elsewhere in the frame are said here.

/** How long the line's note speaks (DESIGN.md §8). */
const NOTE_MS = 2_400;

/** What a host lends the line: the capture door, and the still scheme a
 * snapshot's card is drawn through. */
export type ComposerHost = Pick<FieldHost, "screenshotCapture" | "screenshotStillUrl">;

/** What the line lends the palette (One Frame FR-3): its create, so the
 * palette's row for the view's act runs the line's own — Objects on Canvas,
 * New terminal in Godview and in History, with the line's note saying what
 * came of it. */
export interface LineActs {
  create(keyboard?: boolean): void;
}

export interface ComposerProps {
  /** The window's view. */
  readonly view: FrameView;
  readonly keys: ViewKeys;
  /** The views track, drawn by the frame's controller: the line's left end. */
  readonly track: ReactNode;
  /** The frame's open surface, from its one owner. */
  readonly surface: FrameSurface | null;
  readonly onSurfaceChange: (next: FrameSurface | null) => void;
  /** Where the line lends its acts (the palette's door); left out, it lends none. */
  readonly actsRef?: MutableRefObject<LineActs | null>;
  /** Adapters — the catalog's fixtures; the product takes the defaults. What
   * Godview lends the line (undefined: the deck's published door). */
  readonly godview?: LineViewDoor | null;
  /** What History lends the line (undefined: History's published door). */
  readonly history?: HistoryLineDoor | null;
  /** The pegboard, Objects on Canvas (DK-13; undefined: the board of the desk mounted now; null: no board — the
   * create asks the owner for "objects" itself, as the catalog's fixture line does). */
  readonly objects?: BoardLineDoor | null;
  readonly host?: ComposerHost;
  /** The hand a snapshot is dealt into (undefined: the window's own, `cardsStore`). */
  readonly cards?: CardStore;
  /** D6 — where the line hears a paste or typed text a terminal refused for its
   * size (undefined: the window's terminal pool; the tests hand it a fixture,
   * and the catalog draws the state as a plate of the line's view). A hearer of
   * its own beside `hearLineSays`, which carries words alone: the note names
   * the pane, which only the deck's door knows. */
  readonly inputRefusals?: (hear: (refusal: RoutedInputRefusal) => void) => () => void;
  /** Whether the line binds its window keys (B, ⌘T). The catalog's live line
   * does not: its page is not a window the line owns. */
  readonly bindKeys?: boolean;
}

export function Composer({
  view,
  keys,
  track,
  surface,
  onSurfaceChange,
  actsRef,
  godview,
  history,
  objects,
  host: hostProp,
  cards,
  inputRefusals = hearTerminalInputRefusals,
  bindKeys = true,
}: ComposerProps): ReactElement {
  const published = useGodviewLineDoor();
  const door = godview === undefined ? published : godview;
  const publishedHistory = useHistoryLineDoor();
  const historyDoor = history === undefined ? publishedHistory : history;
  const publishedBoard = useBoardLineDoor();
  const board = objects === undefined ? publishedBoard : objects;
  /** R14 — an object is in hand on Canvas: the desk refuses the board (the create faint, "Put it down first"). */
  const boardRefused = board?.held === true && !board.open;
  const host = hostProp ?? getHost();
  const [note, setNote] = useState<LineNote | null>(null);
  const notes = useRef(0);
  /** A capture in flight — the tool is modal, one at a time: the snapshot stays filled until it answers. */
  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);
  /** What the tool last said of itself, from either press (`capture-state.ts`): no helper here, or
   * Screen Recording off — the snapshot waits, or says why in its tooltip. */
  const captureState = useCaptureState();

  const say = useCallback((text: string, where: LineNote["at"]) => {
    notes.current += 1;
    setNote({ seq: notes.current, text, at: where });
  }, []);
  // PJ-4 — what History's own acts came to (a row's Resume, New agent, a
  // project's act) is said where the create's outcome is
  const historySaid = useHistorySaid();
  const heardSaid = useRef(historySaid?.seq ?? 0);
  useEffect(() => {
    if (historySaid === null || historySaid.seq === heardSaid.current) return;
    heardSaid.current = historySaid.seq;
    say(historySaid.text, "create");
  }, [historySaid, say]);
  useEffect(() => {
    if (note === null) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);
  // what the frame says on the line — a live row the Peek opened that could not
  // be shown (P2), the last pane's ⌘W, an act waiting on Godview's question —
  // from the line's left edge, where a long sentence has the window to grow into
  useEffect(() => hearLineSays((text) => say(text, "line")), [say]);
  // D6 — a paste (or typed text) a terminal refused for its size: said on the
  // line, the pane named as the deck names it — except a card's play, which
  // claims its own refusal and says it as its outcome (HN-L5: said once)
  const doorRef = useRef(door);
  doorRef.current = door;
  useEffect(() => {
    return inputRefusals((refusal) => {
      if (refusalClaimed()) return;
      const pane = doorRef.current?.panes.find((entry) => entry.sessionId === refusal.sessionId);
      say(inputRefusalNote(refusal, pane?.name), "line");
    });
  }, [inputRefusals, say]);

  // THE HAND'S LAB DOOR (`window.__vfCards`, cards-lab.ts): a headless smoke's
  // hands for the window's hand, lent while the line owns the window — the
  // catalog's live line, which binds no keys, lends none.
  useEffect(() => {
    if (!bindKeys) return;
    return installCardsLab(cards === undefined ? {} : { store: cards });
  }, [bindKeys, cards]);

  // A view change is a change of place: whatever the frame had open folds —
  // the line's surface and, since the owner holds them too, the head's.
  const shownView = useRef(view);
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    if (surface !== null) onSurfaceChange(null);
  }, [view, surface, onSurfaceChange]);

  const newTerminal = useCallback(async () => {
    if (door === null) {
      say(newTerminalNote({ state: "refused", reason: "the deck is not connected yet" }), "create");
      return;
    }
    say(newTerminalNote(await door.newTerminal()), "create");
  }, [door, say]);

  // History's create is New terminal (LN-D2, HN-7): a fresh shell in the folder
  // of the project the room shows, opened by Godview's deck — History's door
  // finds the folder as New agent does, refuses one it cannot open in New
  // agent's words, and moves the frame to Godview to show the shell. The note
  // says Godview's words — in History, or in Godview once the frame has moved
  // there. (Resume and Jump to were this create until HN-7: the chosen
  // session's acts now, the palette's History row among them.)
  const historyTerminal = useCallback(async () => {
    if (historyDoor === null) {
      say(newTerminalNote({ state: "refused", reason: "History is still opening" }), "create");
      return;
    }
    say(newTerminalNote(await historyDoor.newTerminal()), "create");
  }, [historyDoor, say]);

  // Objects on Canvas (DK-13; DESIGN.md §8 "The pegboard"): the create calls the board's `toggle()` and the frame's
  // owner is told what came of it — the board out is the open surface "objects" (folding any other), shut it is folded.
  // In hand the desk refuses it (R14). With no board (the catalog's fixture line) the create asks the owner itself.
  const create = useCallback(
    (keyboard = false) => {
      if (view === "canvas") {
        if (board === null) {
          onSurfaceChange(surface === "objects" ? null : "objects");
          return;
        }
        if (boardRefused) return;
        const open = board.toggle(keyboard);
        if (open === null) return;
        onSurfaceChange(open ? "objects" : foldSurface(surface, "objects"));
      } else if (view === "godview") void newTerminal();
      else if (view === "history") void historyTerminal();
    },
    [board, boardRefused, historyTerminal, newTerminal, onSurfaceChange, surface, view],
  );

  // THE SNAPSHOT (HN-D2; SNAP-D3): the snapshot tool, opened as ⌃⌘A opens it —
  // the screen frozen, a region dragged or the window clicked, Done. What it
  // keeps is dealt into the hand from its region, the deal every source makes
  // (`dealCapture`; never the store by hand). Its still is on the clipboard too,
  // the tool's own doing. A cancel says nothing; a failure says so on the line,
  // in the words the hand says of a capture main ran (`CAPTURE_WORDS`, one
  // copy). What the answer says of the tool itself — no helper here, Screen
  // Recording off — is kept for the snapshot's own state (`noteCapture`, which
  // the hand's subscription to main's ⌃⌘A feeds too). The view is the one it
  // was pressed in: the tool is modal, nothing moves.
  const snapshot = useCallback(() => {
    const capture = host.screenshotCapture;
    if (capture === undefined || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    const done = (): void => {
      capturingRef.current = false;
      setCapturing(false);
    };
    void capture().then(
      (result) => {
        done();
        noteCapture(result);
        if (result.status === "ok") {
          dealCapture(result, host, view, cards === undefined ? {} : { store: cards });
        } else if (result.status === "error") {
          say(captureRefusal(result), "line");
        }
      },
      (cause: unknown) => {
        done();
        say(CAPTURE_WORDS.failed(cause instanceof Error ? cause.message : String(cause)), "line");
      },
    );
  }, [cards, host, say, view]);

  // The palette runs the view's act through the line (One Frame FR-3), so the
  // two doors to one act are one implementation and speak with one note.
  useLayoutEffect(() => {
    if (actsRef === undefined) return;
    actsRef.current = { create };
    return () => {
      actsRef.current = null;
    };
  }, [actsRef, create]);

  // B — Objects, on Canvas only, never while typing (a field holds the caret:
  // the frame's one test, `cards/caret.ts`), never under a cover (DESIGN.md §8
  // "The pegboard", §10), and refused while an object is in hand (R14). Heard
  // on the window's bubble phase, so a focused pane or a note being typed in
  // keeps its own b. A board B raises takes the focus (the keyboard asked for
  // it): its specimens are the arrows' at once.
  useEffect(() => {
    if (!bindKeys) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "b" && event.key !== "B") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (view !== "canvas" || isField(event.target)) return;
      if (boardRefused) {
        emitLineKeyMarker({ key: "B", view, outcome: "refused" });
        return;
      }
      const wasOpen = board === null ? surface === "objects" : board.open;
      create(true);
      emitLineKeyMarker({ key: "B", view, outcome: wasOpen ? "closed" : "opened" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bindKeys, board, boardRefused, create, surface, view]);

  // ⌘T — New terminal, in Godview and in History (HN-7): a product chord on
  // the capture phase, so a focused pane never sees it (ghostty's new_tab).
  // Only in those two views: it is their create's key, as B is Canvas's.
  const takesNewTerminal = bindKeys && (view === "godview" || view === "history");
  useEffect(
    () =>
      listenForProductChord(
        (event) => takesNewTerminal && isNewTerminalChord(event, keys),
        (event) => {
          if (event.repeat) return;
          emitLineKeyMarker({
            key: keys === "mac" ? "⌘T" : "Ctrl+T",
            view,
            outcome: "new-terminal",
          });
          void (view === "history" ? historyTerminal() : newTerminal());
        },
      ),
    [historyTerminal, keys, newTerminal, takesNewTerminal, view],
  );

  const createWaits = view === "godview" && door === null ? "the deck is not connected yet" : null;

  return (
    <ComposerLineView
      view={view}
      keys={keys}
      track={track}
      objectsOpen={board === null ? surface === "objects" : board.open}
      createHeld={boardRefused}
      createWaits={createWaits}
      createProject={view === "history" ? (historyDoor?.project ?? null) : null}
      snapshotWaits={host.screenshotCapture === undefined ? SNAPSHOT_NO_DOOR : captureState.waits}
      snapshotWhy={captureState.why}
      snapshotOn={capturing}
      note={note}
      onCreate={create}
      onSnapshot={snapshot}
    />
  );
}
