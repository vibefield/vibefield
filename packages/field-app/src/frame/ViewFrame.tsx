import type { FrameView } from "@vibefield/contracts";
import {
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { emitViewKeyMarker } from "../development-console";
import { listenForProductChord } from "../field/product-chords";
import { historyImporting, useIndexStatus } from "../history/first-reading";
import { getHost } from "../host";
import { Composer, type LineActs } from "./Composer";
import type { FrameSurface } from "./frame-surface";
import { type CoverState, coverAfter, coverAt, ViewCoverView } from "./ViewCover";
import { type ViewKeyPress, ViewsTrackView } from "./ViewsTrack";
import { requestView, useActiveView } from "./view-state";
import { FRAME_VIEWS, viewForKey, viewKeysOf } from "./views";

// THE VIEW FRAME (One Frame FR-1; DESIGN.md §10, §8, §6) — the controller.
// It reads the window's view from its one owner (main, mirrored by
// `view-state.ts`), asks that owner for another, and draws the frame over the
// views: the cover the covered views live in, and the line above it with the
// views track at its left end (FR-2; the line's own controller is
// `Composer.tsx`). What it owns is only presentation — the ⌘-held light, the
// key's dip, and which motion the cover is making —
// never the view, and never which of the frame's surfaces is open, which has
// its own one owner (`frame-surface.ts`).

/** How long ⌘ is held alone before the keys light (DESIGN.md §8): long enough
 * that ⌘C and ⌘V never set it off. */
const HOLD_MS = 400;

export function ViewFrame({
  godview,
  history,
  chat,
  surface,
  onSurfaceChange,
  lineActs,
}: {
  godview: ReactNode;
  /** History's view (AR-8c: rosetta's room, `history/HistoryView.tsx`), drawn
   * once History has first been opened and kept after; `active` is whether it
   * is the view showing. */
  history?: (active: boolean) => ReactNode;
  /** Chat's view (SP-1b), drawn once Chat has first been opened and kept
   * after, as History's is; `active` is whether it is the view showing. */
  chat?: (active: boolean) => ReactNode;
  /** The frame's open surface, from its one owner. */
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  /** Where the line lends its acts to the palette (One Frame FR-3). */
  lineActs?: MutableRefObject<LineActs | null>;
}): ReactElement {
  const view = useActiveView();
  const [keys] = useState(() => viewKeysOf(getHost().platform));
  const [held, setHeld] = useState(false);
  const [press, setPress] = useState<ViewKeyPress | null>(null);
  const presses = useRef(0);
  const current = useRef(view);
  current.current = view;
  // AO-4b — History's cell carries the arc while History imports, heard pushed
  // (`index.status.subscribe`), whether or not History was ever opened.
  const importing = historyImporting(useIndexStatus());

  // The cover's motion is decided when the view changes and KEPT until the
  // next change, so an unrelated render mid-fade (a dip, the ⌘ light) can never
  // cancel a swap's fade. React's own "state from the previous render" pattern.
  const [shown, setShown] = useState<FrameView>(view);
  const [cover, setCover] = useState<CoverState>(() => coverAt(view));
  if (shown !== view) {
    setShown(view);
    setCover(coverAfter(cover, shown, view));
  }
  // History's view (AR-8c) mounts on History's first open — rosetta's room reads
  // the whole catalog and holds a stream per open session, none of which a
  // window that never shows History should pay for — and stays mounted after,
  // so ⌘3 out and back in keeps its scroll, its selection and its open stream.
  const [historyOpened, setHistoryOpened] = useState(view === "history");
  if (view === "history" && !historyOpened) setHistoryOpened(true);
  // Chat's view (SP-1b) mounts the same way: on its first open, and kept.
  const [chatOpened, setChatOpened] = useState(view === "assistant");
  if (view === "assistant" && !chatOpened) setChatOpened(true);

  /** A view was chosen — by its key or by its cell — and is asked of the
   * owner. Only a key dips the thumb (the button is the key) and tells the
   * probe what it did. */
  const choose = useCallback((asked: FrameView, fromKey: boolean): void => {
    const from = current.current;
    const cell = FRAME_VIEWS.find((entry) => entry.view === asked);
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

  const select = useCallback((asked: FrameView) => choose(asked, false), [choose]);

  return (
    <>
      <ViewCoverView
        view={view}
        content={cover.content}
        motion={cover.motion}
        godview={godview}
        history={historyOpened ? history?.(view === "history") : null}
        chat={chatOpened ? chat?.(view === "assistant") : null}
      />
      <Composer
        view={view}
        keys={keys}
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        {...(lineActs === undefined ? {} : { actsRef: lineActs })}
        track={
          <ViewsTrackView
            view={view}
            keys={keys}
            held={held}
            press={press}
            onSelect={select}
            importing={importing}
          />
        }
      />
    </>
  );
}
