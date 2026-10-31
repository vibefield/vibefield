import type { FrameView } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type { ReactElement, ReactNode, Ref } from "react";
import { ariaKeys, type CreateAct, createActOf, SNAPSHOT, snapshotKey } from "./line-model";
import type { ViewKeys } from "./views";
import "./composer.css";

// THE LINE (DESIGN.md §8 "The line", §5, §10; One Frame FR-2, FR-3, FC-D3,
// FC-D14; LN-D1, HN-L6) — the frame's foot, controller-free so the catalog
// mounts this exact markup on fixtures. `[views] snapshot create` in every view:
// the views track arrives as a slot (its own component, its own keys); SNAP's
// door and the view's one act are drawn here, and the note over them is the
// frame's voice. What the line DOES lives in `Composer.tsx`; what it shows is
// all props.

/** What the line's note says, and where it stands. `seq` counts notes, so the
 * same words said twice are said twice. `create`: centred over the create — its
 * own outcome, and what History's acts came to (PJ-4); `line`: its left edge on
 * the line's, growing rightward — everything else the frame says on the line (a
 * pane's refused input, D6; the Peek's refused pick, P2; Godview's ⌘W; a
 * snapshot the tool could not take). */
export interface LineNote {
  readonly seq: number;
  readonly text: string;
  readonly at: "create" | "line";
}

export interface ComposerLineViewProps {
  readonly view: FrameView;
  readonly keys: ViewKeys;
  /** The views track — its left end. */
  readonly track: ReactNode;
  /** Objects is out (Canvas): create wears its ✕ — the board's `open`, mirrored (DK-13). */
  readonly objectsOpen?: boolean;
  /** An object is in hand (Canvas): the desk refuses the board — the create is faint by ink, "Put it down first"
   * (R14). */
  readonly createHeld?: boolean;
  /** Why the create act waits, said in its tooltip; null when it can act. */
  readonly createWaits?: string | null;
  /** History's chosen session runs here: its create is Jump to (P3). */
  readonly createLive?: boolean;
  /** Why the snapshot waits — the host lends no capture door, or the tool said no helper is here
   * (`capture-state.ts`) — faint by ink, said in its tooltip; null when it can act. */
  readonly snapshotWaits?: string | null;
  /** Why the last capture was refused while the snapshot can still be pressed — Screen Recording
   * is off, and a press asks the system again — said in its tooltip in place of its key. */
  readonly snapshotWhy?: string | null;
  /** A capture is in flight: the snapshot stays filled until the tool answers. */
  readonly snapshotOn?: boolean;
  /** The catalog's plate of the snapshot under the pointer; the product's pointer is CSS's own `:hover`. */
  readonly snapshotHot?: boolean;
  readonly note?: LineNote | null;
  readonly lineRef?: Ref<HTMLDivElement>;
  /** The create was pressed — `keyboard`: by its keys (Enter or Space on it), not the pointer. */
  readonly onCreate?: (keyboard: boolean) => void;
  /** The snapshot was pressed. */
  readonly onSnapshot?: () => void;
}

const CREATE_GLYPHS = ["plus", "start", "resume", "jump"] as const;

/** R14 — the create's word while an object is in hand: the desk refuses the board. */
export const PUT_IT_DOWN_FIRST = "Put it down first";

function createTitle(act: CreateAct, open: boolean, waits: string | null, held: boolean): string {
  if (open) return "Close  Esc";
  if (held) return PUT_IT_DOWN_FIRST;
  if (waits !== null) return `${act.name} — ${waits}`;
  return act.key === null ? act.name : `${act.name}  ${act.key}`;
}

/** The create's key as `aria-keyshortcuts` spells it — read off the act's own key, never a letter of its own. */
function createKeys(act: CreateAct): string | undefined {
  return act.key === null ? undefined : ariaKeys(act.key);
}

export function ComposerLineView({
  view,
  keys,
  track,
  objectsOpen = false,
  createHeld = false,
  createWaits = null,
  createLive = false,
  snapshotWaits = null,
  snapshotWhy = null,
  snapshotOn = false,
  snapshotHot = false,
  note = null,
  lineRef,
  onCreate,
  onSnapshot,
}: ComposerLineViewProps): ReactElement {
  const act = createActOf(view, keys, createLive);
  const open = view === "canvas" && objectsOpen;
  const held = view === "canvas" && !open && createHeld;
  const waits = open ? null : createWaits;
  const snapKey = snapshotKey(keys);
  const snapSays = snapshotWaits ?? snapshotWhy;
  const snapTitle = snapSays === null ? `${SNAPSHOT}  ${snapKey}` : `${SNAPSHOT} — ${snapSays}`;
  return (
    // biome-ignore lint/a11y/useSemanticElements: the line is a row of controls, not a fieldset of form inputs
    <div ref={lineRef} className="vf-line" role="group" aria-label="The line" data-view={view}>
      {track}
      <button
        type="button"
        className="vf-line-snapshot"
        aria-label={SNAPSHOT}
        title={snapTitle}
        aria-keyshortcuts={ariaKeys(snapKey)}
        {...(snapshotWaits === null ? {} : { "aria-disabled": true })}
        {...(snapshotOn ? { "data-on": "true" } : {})}
        {...(snapshotHot ? { "data-hot": "true" } : {})}
        onClick={() => {
          if (snapshotWaits === null && !snapshotOn) onSnapshot?.();
        }}
      >
        <FieldGlyph name="capture" size={18} />
      </button>
      {act === null ? null : (
        <button
          type="button"
          className="vf-line-create"
          data-view={view}
          aria-label={open ? "Close the objects" : act.name}
          title={createTitle(act, open, waits, held)}
          aria-keyshortcuts={open ? "Escape" : createKeys(act)}
          {...(view === "canvas" ? { "aria-expanded": open } : {})}
          {...(waits !== null || held ? { "aria-disabled": true } : {})}
          {...(held ? { "data-held": "true" } : {})}
          onClick={(event) => {
            // a click with no pointer behind it (detail 0) is the create's keys: Enter or Space on it
            if (waits === null && !held) onCreate?.(event.detail === 0);
          }}
        >
          {CREATE_GLYPHS.map((glyph) => (
            <span
              key={glyph}
              className="vf-line-create-glyph"
              data-glyph={glyph}
              {...(glyph === act.glyph ? { "data-shown": "true" } : {})}
            >
              <FieldGlyph name={glyph} size={16} />
            </span>
          ))}
        </button>
      )}
      {note === null ? null : (
        <div key={note.seq} className="vf-line-note" data-at={note.at} role="status">
          {note.text}
        </div>
      )}
    </div>
  );
}
