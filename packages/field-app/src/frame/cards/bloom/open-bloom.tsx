import { createRoot } from "react-dom/client";
import { type BloomPoint, CARD_BLOOM } from "./bloom-geometry";
import type { BloomModel } from "./bloom-model";
import { CardBloomView } from "./CardBloomView";

/**
 * THE CARD'S BLOOM, OPENED (lanes/ob-build/SEAM.md: the drop's own call). The window's size is read once, as it opens.
 * `choose` answers once, with a face or null for nothing; `close()` folds it with no answer, for a change of view or a
 * place that has gone. Either way the buds go back along their spokes before it leaves the page.
 */
export function openBloom(
  card: { readonly title: string },
  model: BloomModel,
  at: BloomPoint,
  choose: (face: string | null) => void,
): { close(): void } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const field = { width: window.innerWidth, height: window.innerHeight };
  let done = false;

  const draw = (closing: boolean): void => {
    root.render(
      <CardBloomView
        model={model}
        at={at}
        field={field}
        title={card.title}
        closing={closing}
        choose={(face) => {
          if (done) return;
          leave();
          choose(face);
        }}
      />,
    );
  };

  const leave = (): void => {
    done = true;
    draw(true);
    window.setTimeout(() => {
      root.unmount();
      host.remove();
    }, CARD_BLOOM.retract + 20);
  };

  draw(false);
  return {
    close() {
      if (!done) leave();
    },
  };
}
