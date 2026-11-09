import type { BloomModel } from "../card-landing";
import type { Card } from "../cards-model";

/**
 * The drop's bloom (OB-1b's stub; ow-design replaces this file). The card stays carried where it landed; `choose` is
 * called with the face chosen, or null to put the card back, and at most once. `close()` takes the bloom down with
 * nothing chosen and never calls `choose`: the drag calls it for a view change, a closed pane, or a new drag.
 */
export function openBloom(
  _card: Card,
  _model: BloomModel,
  _at: { readonly x: number; readonly y: number },
  _choose: (face: string | null) => void,
): { close(): void } {
  return { close: () => undefined };
}
