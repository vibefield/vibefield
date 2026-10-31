import type { ReactElement } from "react";
import type { ThreadItem } from "./thread-items";

// THE THREAD'S ITEMS, DRAWN (SP-1d; DESIGN.md §8 "Chat's thread") — controller-free. They stand in the thread's foot,
// as wide as it, their foot 12 above it, and grow upward over the pane (`.vf-chat-items`, chat.css): positioned in
// the foot, never in the column's flow, so nothing here changes the pane's size.

/** Each kind of item, drawn by its own case; a kind added to `ThreadItem` fails to compile here until it is. */
function itemView(item: ThreadItem): ReactElement {
  const undrawn: never = item;
  throw new Error(`a thread item this build does not draw: ${JSON.stringify(undrawn)}`);
}

export function ThreadItemsView({ items }: { items: readonly ThreadItem[] }): ReactElement | null {
  if (items.length === 0) return null;
  return <div className="vf-chat-items">{items.map(itemView)}</div>;
}
