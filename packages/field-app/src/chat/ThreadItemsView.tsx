import type { NeedsItem } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { UiButton } from "@vibefield/design-kit/primitives";
import { SparkFace } from "@vibefield/design-kit/spark-face";
import type { ReactElement, Ref } from "react";
import { NeedsCardView } from "./NeedsCardView";
import type { HelloItem, ThreadItem } from "./thread-items";

// THE THREAD'S ITEMS, DRAWN (SP-1d; DESIGN.md §8 "Chat's thread") — controller-free, so the catalog draws this markup
// on fixtures. They stand in the thread's foot, as wide as it, their foot 12 above it, and grow upward over the pane
// (`.vf-chat-items`, chat.css): positioned in the foot, never in the column's flow, so nothing here changes the pane's
// size. Each item's root says its kind (`data-item`).

export interface ThreadItemsViewProps {
  items: readonly ThreadItem[];
  /** a starter pressed: its words, sent as Send sends (absent: the catalog, where nothing is sent) */
  onStarter?: ((words: string) => void) | undefined;
  /** a send into the thread runs, a starter's or Send's: the starters wait, and a press does nothing */
  sending?: boolean | undefined;
  /** CP-3 — an act pressed on the needs-you card, by its place (absent: the catalog, where nothing is answered) */
  onAnswer?: ((item: NeedsItem, choice: number) => void) | undefined;
  /** CP-3 — Show pressed on an agent's ask: its pane in Godview */
  onShow?: ((item: NeedsItem) => void) | undefined;
  /** CP-3 — the needs-you card's own element, which the keyboard is put on */
  cardRef?: Ref<HTMLDivElement> | undefined;
}

/** NS-D4's hello: the spark's face as its lead, its words, and the three starters one under another. */
function HelloView({
  item,
  onStarter,
  sending,
}: {
  item: HelloItem;
  onStarter: ((words: string) => void) | undefined;
  sending: boolean;
}): ReactElement {
  return (
    <div className="vf-chat-hello" data-item="hello">
      <div className="vf-chat-hello-lead">
        <SparkFace seed={item.face.seed} status={item.face.status} size={28} />
        <p className="vf-chat-hello-words">{item.words}</p>
      </div>
      <div className="vf-chat-starters" {...(sending ? { "aria-busy": true } : {})}>
        {item.starters.map((starter) => (
          <UiButton
            key={starter.glyph}
            className="vf-chat-starter"
            onClick={() => {
              if (!sending) onStarter?.(starter.words);
            }}
          >
            <FieldGlyph name={starter.glyph} size={14} />
            <span>{starter.words}</span>
          </UiButton>
        ))}
      </div>
    </div>
  );
}

export function ThreadItemsView({
  items,
  onStarter,
  sending = false,
  onAnswer,
  onShow,
  cardRef,
}: ThreadItemsViewProps): ReactElement | null {
  if (items.length === 0) return null;
  /** Each kind of item, drawn by its own case; a kind added to `ThreadItem` fails to compile here until it is. */
  const itemView = (item: ThreadItem, index: number): ReactElement => {
    const key = `${item.kind}:${index}`;
    switch (item.kind) {
      case "hello":
        return <HelloView key={key} item={item} onStarter={onStarter} sending={sending} />;
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
      default: {
        const undrawn: never = item;
        const { kind } = undrawn as { readonly kind: unknown };
        throw new Error(`a thread item this build does not draw: ${String(kind)}`);
      }
    }
  };
  return <div className="vf-chat-items">{items.map(itemView)}</div>;
}
