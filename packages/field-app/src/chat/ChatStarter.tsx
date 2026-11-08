import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { UiButton } from "@vibefield/design-kit/primitives";
import type { ReactElement } from "react";
import type { Starter } from "./thread-items";
import "./chat-starter.css";

// A STARTER (NS-D4; DESIGN.md §8 "Chat's thread", the hello and three starters; track ES, ES-D2 A, 2026-11-08) — one
// job a spark can start on: the kit's button with its glyph and its words. The hello's (the thread's first row,
// `ThreadFlowView`) and the empty night's (`ChatEmptyView`) are this one button, one behaviour for one look; on the
// night it wears night glass (`chat-empty.css`). Controller-free: what a press does is its holder's.

export function ChatStarter({
  starter,
  onPress,
}: {
  starter: Starter;
  /** pressed: the hello sends it as Send sends; the night opens the sheet carrying it */
  onPress?: (() => void) | undefined;
}): ReactElement {
  return (
    <UiButton className="vf-chat-starter" onClick={() => onPress?.()}>
      <FieldGlyph name={starter.glyph} size={14} />
      <span>{starter.words}</span>
    </UiButton>
  );
}
