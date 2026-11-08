import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { UiButton } from "@vibefield/design-kit/primitives";
import type { ReactElement } from "react";
import type { Starter } from "./thread-items";
import "./chat-starter.css";

// A STARTER (NS-D4; DESIGN.md §8 "Chat's thread", the hello and three starters; track ES, ES-D2 A, 2026-11-08) — one
// job a spark can start on: the kit's button with its glyph and its words. The hello's (the thread's first row,
// `ThreadFlowView`) and the empty night's (`ChatEmptyView`) are this one button, one behaviour for one look; on the
// night it wears night glass (`chat-empty.css`). Controller-free: what a press does is its holder's.
// *ES-2 (2026-11-08):* the New spark sheet carries one as its first job, still (`StillStarter`): the same look, never
// a press, its × at its end (§8 "The New spark sheet", Its first job, Drawn).

export function ChatStarter({
  starter,
  held = false,
  onPress,
  onHold,
}: {
  starter: Starter;
  /** ES-4 — this Mac's agents and board are being read: it holds its place, wordless, and a press does nothing */
  held?: boolean | undefined;
  /** pressed: the hello sends it as Send sends; the night opens the sheet carrying it */
  onPress?: (() => void) | undefined;
  /** ES-3a — the pointer or the keyboard's focus came to it or left it (the night leans while one holds a job) */
  onHold?: ((by: "pointer" | "focus", held: boolean) => void) | undefined;
}): ReactElement {
  return (
    <UiButton
      className="vf-chat-starter"
      {...(held ? { "data-held": "true", "aria-busy": true } : {})}
      onClick={() => {
        if (!held) onPress?.();
      }}
      {...(onHold === undefined
        ? {}
        : {
            onPointerEnter: () => onHold("pointer", true),
            onPointerLeave: () => onHold("pointer", false),
            onFocus: () => onHold("focus", true),
            onBlur: () => onHold("focus", false),
          })}
    >
      <FieldGlyph name={starter.glyph} size={14} />
      <span>{starter.words}</span>
    </UiButton>
  );
}

/** A starter held still, as the sheet carries its first job: the starter's own look, never a press, with its × at its
 * end, named by its holder. */
export function StillStarter({
  starter,
  remove,
}: {
  starter: Starter;
  /** its ×: what it is named, and what a press of it does */
  remove: { readonly label: string; readonly onPress: () => void };
}): ReactElement {
  return (
    <span className="vf-chat-starter" data-still="true">
      <FieldGlyph name={starter.glyph} size={14} />
      <span>{starter.words}</span>
      <button
        type="button"
        className="vf-chat-starter-remove"
        aria-label={remove.label}
        title={remove.label}
        onClick={remove.onPress}
      >
        <FieldGlyph name="close" size={13} />
      </button>
    </span>
  );
}
