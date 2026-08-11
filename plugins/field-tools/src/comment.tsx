/**
 * CommentCard — the UE-Blueprint comment box (2026-07-18, James: "select
 * multiple widget and hit C key, a comment widget will appear and wrap the
 * selected widgets"). Semi-transparent tinted body + tinted header bar with
 * an inline-editable title; the accent color is random per spawn (palette
 * lives in commands.ts, curated to the lab's card accents).
 *
 * NOT a container: folders reparent children into a nested frame — comment
 * membership is SPATIAL. `interaction.sweepContained` makes a move claim on
 * the comment also claim every widget fully inside its bounds (engine
 * l3-claim sweep), so the group drags as one, and dragging a member out is
 * nothing at all — it just stops being inside. The C handler spawns the
 * comment at the BOTTOM of the stack (spawn z), so members render on top and
 * picking hits them first; pressing the tinted body (or header) grabs the
 * comment itself.
 *
 * Title editing rides the widget-event contract: the header shows a SPAN
 * (drag surface — a full-width input would make the whole header
 * un-draggable, since native interactives auto-opt-out, design-002 §8);
 * DOUBLE-CLICK swaps in a focused <input> (the UE rename gesture). The edit
 * commits ONE setWidgetProps tx on blur/Enter — per-keystroke transactions
 * would shred the undo stack.
 */
import {
  type Entity,
  Selected,
  useOps,
  useWidgetProps,
  type World,
} from "@vibefield/plugin-sdk/canvas";
import { useDragLift } from "@vibefield/plugin-sdk/ui";
import {
  type CSSProperties,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useState,
} from "react";
import "./comment.css";

const TYPE = "vibefield.field-tools.comment";

function CommentView({ entity, world }: { entity: Entity; world: World }): ReactElement {
  const props = useWidgetProps<{ title: string; color: string }>(world, entity, TYPE);
  const ops = useOps();
  const title = props?.title ?? "Comment";
  const color = props?.color ?? "var(--vf-accent-1)";
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(false);
  const { lifted, scale } = useDragLift(world, entity); // the shared iOS lift

  useEffect(() => {
    const id = setInterval(() => setSelected(world.hasTag(entity, Selected)), 80);
    return () => clearInterval(id);
  }, [world, entity]);

  const commit = (): void => {
    const next = draft.trim();
    if (next !== "" && next !== title) ops.setWidgetProps(entity, { title: next });
    setEditing(false);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") (event.target as HTMLInputElement).blur();
    if (event.key === "Escape") {
      setDraft(title); // discard — blur commits the unchanged title
      (event.target as HTMLInputElement).blur();
    }
  };

  return (
    <div
      className="vf-comment-card"
      data-lifted={lifted ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      style={
        {
          "--vf-comment-color": color,
          "--vf-comment-lift-scale": scale,
        } as CSSProperties
      }
    >
      <div className="vf-comment-card__header">
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoFocus
            className="vf-comment-card__title vf-comment-card__input"
            aria-label="Comment title"
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation(); // rename, not an engine gesture
              setDraft(title);
              setEditing(true);
            }}
            className="vf-comment-card__title"
            title="Double-click to rename"
            data-comment-title
          >
            {title}
          </span>
        )}
      </div>
    </div>
  );
}

// C1b: the defineWidget call is GONE — the host builds the prefab from the
// canonical manifest (§12.2). This module ships only the component.
export const COMMENT_TYPE = TYPE;
export { CommentView };
