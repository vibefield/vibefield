import { defineWidget, p } from "@vibecook/ice";
import {
  useOps,
  useSelected,
  useWidgetProps,
  type WidgetComponentProps,
} from "@vibecook/ice/react";
import { type ReactElement, useRef, useState } from "react";

// The note card (B2's proof widget). Input contract (predesign-03 §2.3 interim
// rules, matching ICE's real boundaries):
// - the textarea is a native editable → the canvas keymap ignores keys and the
//   pointer adapter skips select/drag on it automatically;
// - dblclick-to-edit stops propagation so the gesture never becomes a canvas fact;
// - wheel inside scrollable text stops propagation (the one gap ICE leaves to
//   widgets today — I4 will make it a predicate).
// Durable text commits ONCE on blur (undo-stack hygiene), never per keystroke.

const TYPE = "note.card";

interface NoteProps extends Record<string, unknown> {
  text: string;
  color: string;
}

function NoteView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<NoteProps>(world, entity, TYPE);
  const selected = useSelected(world, entity);
  const ops = useOps();
  const text = props?.text ?? "";
  const color = props?.color ?? "#f6e7a9";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);

  const commit = (): void => {
    if (!cancelled.current) {
      const next = draft;
      if (next !== text) ops.setWidgetProps(entity, { text: next });
    }
    cancelled.current = false;
    setEditing(false);
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        borderRadius: 10,
        background: color,
        color: "#3a3524",
        boxShadow: selected
          ? "0 0 0 2px #6ee7c7, 0 6px 18px rgba(0,0,0,0.25)"
          : "0 2px 10px rgba(0,0,0,0.18)",
        overflow: "hidden",
        font: '13.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              cancelled.current = true;
              (e.target as HTMLTextAreaElement).blur();
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
              (e.target as HTMLTextAreaElement).blur();
          }}
          onWheel={(e) => e.stopPropagation()}
          autoFocus
          spellCheck={false}
          style={{
            flex: 1,
            margin: 10,
            padding: 0,
            border: "none",
            outline: "none",
            resize: "none",
            background: "transparent",
            color: "inherit",
            font: "inherit",
          }}
        />
      ) : (
        <div
          onDoubleClick={(e) => {
            e.stopPropagation(); // edit gesture, not a canvas fact
            setDraft(text);
            setEditing(true);
          }}
          onWheel={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            padding: 10,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            cursor: "text",
          }}
        >
          {text.length > 0 ? text : <span style={{ opacity: 0.45 }}>Double-click to edit</span>}
        </div>
      )}
    </div>
  );
}

/** defineWidget registers into ICE's module-level catalog as an import side-effect. */
export const NoteCard = defineWidget({
  type: TYPE,
  surface: "dom",
  props: {
    text: p.string({ default: "" }),
    color: p.string({ default: "#f6e7a9" }),
  },
  component: NoteView,
  defaultSize: { w: 260, h: 180 },
  minSize: { w: 120, h: 80 },
  interaction: { selectable: true, movable: true, resizable: true, snap: "target" },
  provides: ["widget"],
});
