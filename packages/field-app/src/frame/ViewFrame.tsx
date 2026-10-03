import { type FrameView, frameViewBuilt } from "@vibefield/contracts";
import { type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { emitViewKeyMarker } from "../development-console";
import { listenForProductChord } from "../field/product-chords";
import { getHost } from "../host";
import { Composer } from "./Composer";
import type { LineSurface } from "./line-surface";
import {
  type CoverState,
  coverAfter,
  coverAt,
  HistoryPlaceholderView,
  ViewCoverView,
} from "./ViewCover";
import { type ViewKeyPress, ViewsTrackView } from "./ViewsTrack";
import { requestView, useActiveView } from "./view-state";
import { FRAME_VIEWS, viewForKey, viewKeysOf } from "./views";

// THE VIEW FRAME (One Frame FR-1; DESIGN.md §10, §8, §6) — the controller.
// It reads the window's view from its one owner (main, mirrored by
// `view-state.ts`), asks that owner for another, and draws the frame over the
// views: the cover the covered views live in, and the line above it with the
// views track at its left end (FR-2; the line's own controller is
// `Composer.tsx`). What it owns is only presentation — the ⌘-held light, the
// key's dip, the Assistant's note, and which motion the cover is making —
// never the view, and never which of the line's surfaces is open, which has
// its own one owner (`line-surface.ts`).

/** How long ⌘ is held alone before the keys light (DESIGN.md §8): long enough
 * that ⌘C and ⌘V never set it off. */
const HOLD_MS = 400;
/** How long the waiting cell says "not built yet". */
const NOTE_MS = 1400;

export function ViewFrame({
  godview,
  surface,
  onSurfaceChange,
}: {
  godview: ReactNode;
  /** The line's open surface, from its one owner. */
  surface: LineSurface | null;
  onSurfaceChange: (next: LineSurface | null) => void;
}): ReactElement {
  const view = useActiveView();
  const [keys] = useState(() => viewKeysOf(getHost().platform));
  const [held, setHeld] = useState(false);
  const [press, setPress] = useState<ViewKeyPress | null>(null);
  const [note, setNote] = useState<number | null>(null);
  const presses = useRef(0);
  const current = useRef(view);
  current.current = view;

  // The cover's motion is decided when the view changes and KEPT until the
  // next change, so an unrelated render mid-fade (a dip, the ⌘ light) can never
  // cancel a swap's fade. React's own "state from the previous render" pattern.
  const [shown, setShown] = useState<FrameView>(view);
  const [cover, setCover] = useState<CoverState>(() => coverAt(view));
  if (shown !== view) {
    setShown(view);
    setCover(coverAfter(cover, shown, view));
  }

  /** A view was chosen — by its key or by its cell. The waiting view says so
   * and nothing moves (FC-D2); any other is asked of the owner. Only a key
   * dips the thumb (the button is the key) and tells the probe what it did. */
  const choose = useCallback((asked: FrameView, fromKey: boolean): void => {
    const from = current.current;
    const cell = FRAME_VIEWS.find((entry) => entry.view === asked);
    if (!frameViewBuilt(asked)) {
      presses.current += 1;
      setNote(presses.current);
      if (fromKey && cell)
        emitViewKeyMarker({ key: cell.digit, view: asked, from, outcome: "waits" });
      return;
    }
    const moved = asked !== from;
    if (fromKey) {
      presses.current += 1;
      setPress({ seq: presses.current, moved });
      if (cell) {
        emitViewKeyMarker({
          key: cell.digit,
          view: asked,
          from,
          outcome: moved ? "moved" : "stayed",
        });
      }
    }
    if (moved) void requestView(asked);
  }, []);

  // ⌘1–⌘4 — product chords (GT-D21): the window's capture phase, stopped there,
  // so a focused pane never sees them. (Ghostty binds ⌘1–⌘8 to goto_tab; the
  // workspace's own window listener still hears the key after this one and
  // consumes it with nothing to do — the deck has no tabs.) A held key's
  // repeats are claimed too, and do nothing.
  useEffect(
    () =>
      listenForProductChord(
        (event) => viewForKey(event, keys) !== null,
        (event) => {
          const asked = viewForKey(event, keys);
          if (asked === null || event.repeat) return;
          choose(asked, true);
        },
      ),
    [choose, keys],
  );

  // Under a cover the field is frozen and out of reach (DESIGN.md §6), and so
  // must its keys be: the canvas's keymap listens on the window for any key no
  // control claims, so with nothing focused — History's room holds no control —
  // Delete or ⌘Z would act on a selection nobody can see. A key aimed at the
  // document itself is stopped on the capture phase, where the product's own
  // chords (this node's other listeners) still run; a key aimed at a view's
  // control, a dialog or the frame goes on as ever. (FieldView makes the field
  // inert under a cover, so nothing in it can hold the keyboard either.)
  useEffect(() => {
    if (view === "canvas") return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target === document || target === document.body || target === document.documentElement) {
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [view]);

  // ⌘ held ALONE for 400ms lights the keys; letting go, another key with it, a
  // pointerdown, a wheel or the window losing focus puts them out (§8). Heard
  // on the capture phase for the same reason as the chords: a focused pane
  // consumes its keys at the target.
  useEffect(() => {
    const modifier = keys === "mac" ? "Meta" : "Control";
    let timer: number | null = null;
    const out = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      setHeld(false);
    };
    const onDown = (event: KeyboardEvent): void => {
      if (event.key !== modifier) {
        out();
        return;
      }
      if (event.repeat || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        setHeld(true);
      }, HOLD_MS);
    };
    const onUp = (event: KeyboardEvent): void => {
      if (event.key === modifier) out();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("pointerdown", out, true);
    window.addEventListener("wheel", out, { capture: true, passive: true });
    window.addEventListener("blur", out);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("pointerdown", out, true);
      window.removeEventListener("wheel", out, { capture: true });
      window.removeEventListener("blur", out);
    };
  }, [keys]);

  useEffect(() => {
    if (note === null) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  const select = useCallback((asked: FrameView) => choose(asked, false), [choose]);

  return (
    <>
      <ViewCoverView
        view={view}
        content={cover.content}
        motion={cover.motion}
        godview={godview}
        history={<HistoryPlaceholderView />}
      />
      <Composer
        view={view}
        keys={keys}
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        track={
          <ViewsTrackView
            view={view}
            keys={keys}
            held={held}
            press={press}
            note={note}
            onSelect={select}
          />
        }
      />
    </>
  );
}
