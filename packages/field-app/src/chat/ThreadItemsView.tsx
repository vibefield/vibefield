import type { NeedsItem } from "@vibefield/contracts";
import type { ReactElement, Ref } from "react";
import { NeedsCardView } from "./NeedsCardView";
import type { ThreadItem } from "./thread-items";

// THE THREAD'S ITEMS, DRAWN (SP-1d; DESIGN.md §8 "Chat's thread") — controller-free, so the catalog draws this markup
// on fixtures. They stand in the thread's foot, as wide as it, above the composer, covering nothing (TH-1;
// `.vf-chat-items`, chat.css). Each item's root says its kind (`data-item`).
// *Amended 2026-11-05 (TH-1, the pane leaves Chat):* they stood positioned over the pane's bottom rows, never in the
// column's flow, and the hello was drawn here (`HelloView`); the hello is the flow's first row now (`ThreadFlowView`).

export interface ThreadItemsViewProps {
  items: readonly ThreadItem[];
  /** CP-3 — an act pressed on the needs-you card, by its place (absent: the catalog, where nothing is answered) */
  onAnswer?: ((item: NeedsItem, choice: number) => void) | undefined;
  /** CP-3 — Show pressed on an agent's ask: its pane in Godview */
  onShow?: ((item: NeedsItem) => void) | undefined;
  /** CP-3 — the needs-you card's own element, which the keyboard is put on */
  cardRef?: Ref<HTMLDivElement> | undefined;
}

export function ThreadItemsView({
  items,
  onAnswer,
  onShow,
  cardRef,
}: ThreadItemsViewProps): ReactElement | null {
  if (items.length === 0) return null;
  /** Each kind of item, drawn by its own case; a kind added to `ThreadItem` fails to compile here until it is (the
   * switch no longer returns on every path). */
  const itemView = (item: ThreadItem): ReactElement => {
    switch (item.kind) {
      case "needs":
        // one element per item, so the next card rises as its own
        return (
          <NeedsCardView
            key={`needs:${item.item.id}`}
            card={item}
            onAnswer={onAnswer}
            onShow={onShow}
            ref={cardRef}
          />
        );
    }
  };
  return <div className="vf-chat-items">{items.map(itemView)}</div>;
}
