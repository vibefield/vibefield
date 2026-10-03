import { UiButton, UnavailableState } from "@vibefield/design-kit/primitives";
import type { ReactElement } from "react";
import type { DeskUnavailableWords } from "./desk-words";
import "./desk.css";

// THE UNAVAILABLE CARD in the Canvas stage (DESIGN.md §8 "When the desk can't draw"; R18; DK-3) — the
// kit's `UnavailableState` as its 380-wide card on the plain ground (`--vf-canvas-bg` and §2.1's
// CSS-fallback dots — not the mat, which nothing can draw here), centred: what happened, what to do,
// one Reload when a reload could help (a DESK REMOUNT, never a window reload), and ICE's message
// verbatim in the detail slot. Controller-free, so the catalog mounts this exact markup on fixtures;
// the stage decides which words and what Reload does.

export function DeskUnavailableView({
  words,
  onReload,
}: {
  words: DeskUnavailableWords;
  /** The desk remounts on a new layer (the stage's own generation). Absent: no Reload is offered. */
  onReload?: () => void;
}): ReactElement {
  const reload = words.reload && onReload !== undefined;
  return (
    <div className="vf-desk-unavailable" data-desk-unavailable={words.kind}>
      <UnavailableState
        card
        title={words.title}
        description={words.body}
        {...(reload
          ? {
              action: (
                <UiButton variant="primary" onClick={onReload}>
                  Reload
                </UiButton>
              ),
            }
          : {})}
        {...(words.detail === undefined || words.detail === "" ? {} : { detail: words.detail })}
      />
    </div>
  );
}
