import { type FrameView, frameViewBuilt } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type { CSSProperties, KeyboardEvent, ReactElement } from "react";
import { FRAME_VIEWS, type ViewKeys, viewKeyLabel, viewKeyParts, viewKeyShortcut } from "./views";
import "./view-frame.css";

// THE VIEWS TRACK (DESIGN.md §8; One Frame FC-D2, FC-D11, FC-D17) — the frame's
// way to each view, controller-free so the catalog mounts this exact markup on
// fixtures. Four cells, each printing its key under its glyph; the thumb is the
// key that is down. It is the line's left end (FR-2: `ComposerLineView` takes
// it as a slot), on the line's glass; FR-1 drew it there alone.

/** One press of a view's key (⌘ + a digit), for the thumb's 1px dip. `seq`
 * counts presses, so the same key pressed twice dips twice; `moved` holds the
 * dip until the thumb has landed on the cell it slid to. */
export interface ViewKeyPress {
  readonly seq: number;
  readonly moved: boolean;
}

export interface ViewsTrackViewProps {
  /** The window's view: the cell the thumb sits under. */
  view: FrameView;
  /** ⌘ on the Mac, Ctrl elsewhere — how the keys are printed and said. */
  keys: ViewKeys;
  /** ⌘ held alone for 400ms: the keys light up and the glyphs step back. */
  held?: boolean;
  /** The last press of a view's key, or null before the first. */
  press?: ViewKeyPress | null;
  /** While non-null, the waiting cell says so ("Assistant · not built yet");
   * a new number says it again. */
  note?: number | null;
  /** A cell was chosen — by a click, Enter or Space. The waiting cell is
   * chosen too: the controller answers it with the note. */
  onSelect?: (view: FrameView) => void;
  /** AO-4b — History imports (`history/first-reading.ts`): its cell carries
   * the arc (DESIGN.md §6) and its name says so, "History, importing". */
  importing?: boolean;
}

/** The track's glyphs, in CSS px. */
const GLYPH_PX = 15;

export function ViewsTrackView({
  view,
  keys,
  held = false,
  press = null,
  note = null,
  onSelect,
  importing = false,
}: ViewsTrackViewProps): ReactElement {
  const index = Math.max(
    0,
    FRAME_VIEWS.findIndex((cell) => cell.view === view),
  );
  // Space is the canvas's pan modifier, and ICE's adapter prevents its default
  // on every target that is not an editable — a button included, which would
  // then never be pressed by it. So a cell answers Space itself, and ICE leaves
  // alone a key that is already answered.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, chosen: FrameView): void => {
    if (event.key !== " " || event.repeat) return;
    event.preventDefault();
    onSelect?.(chosen);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a fieldset of inputs
    <div
      className="vf-views-line"
      role="group"
      aria-label="Views"
      data-view={view}
      {...(held ? { "data-held": "true" } : {})}
    >
      <div className="vf-views" style={{ "--vf-views-index": index } as CSSProperties}>
        <span className="vf-views-thumb" aria-hidden="true">
          <span
            key={press?.seq ?? 0}
            className="vf-views-thumb-face"
            {...(press === null ? {} : { "data-dip": press.moved ? "landed" : "pressed" })}
          />
        </span>
        {FRAME_VIEWS.map((cell) => {
          const built = frameViewBuilt(cell.view);
          const on = built && cell.view === view;
          const arc = importing && cell.view === "history";
          const { modifier, digit } = viewKeyParts(cell, keys);
          return (
            <button
              key={cell.view}
              type="button"
              className="vf-views-cell"
              data-view={cell.view}
              {...(on ? { "data-on": "true" } : {})}
              {...(built ? { "aria-pressed": on } : { "aria-disabled": true })}
              aria-label={
                built
                  ? arc
                    ? `${cell.name}, importing`
                    : cell.name
                  : `${cell.name}, not built yet`
              }
              aria-keyshortcuts={viewKeyShortcut(cell, keys)}
              title={
                built ? `${cell.name}  ${viewKeyLabel(cell, keys)}` : `${cell.name} — not built yet`
              }
              onClick={() => onSelect?.(cell.view)}
              onKeyDown={(event) => onKeyDown(event, cell.view)}
            >
              <span className="vf-views-glyph" {...(arc ? { "data-importing": "true" } : {})}>
                <FieldGlyph name={cell.glyph} size={GLYPH_PX} />
                {arc && <FieldGlyph name="importing" size={GLYPH_PX} className="vf-views-arc" />}
              </span>
              {/* The cell's name is its label and its key is `aria-keyshortcuts`;
                  the printed key is the picture of both. */}
              <kbd className="vf-views-key">
                <span>{modifier}</span>
                <b>{digit}</b>
              </kbd>
            </button>
          );
        })}
      </div>
      {note === null ? null : (
        <div key={note} className="vf-views-note" role="status">
          Assistant · not built yet
        </div>
      )}
    </div>
  );
}
