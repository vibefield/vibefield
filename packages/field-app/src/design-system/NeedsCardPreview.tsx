import type { NeedsItem, NeedsItemId } from "@vibefield/contracts";
import { SegmentedControl, UiButton } from "@vibefield/design-kit/primitives";
import { type ReactElement, useMemo, useRef, useState } from "react";
import { NeedsCardView } from "../chat/NeedsCardView";
import { type NeedsCardDoors, useNeedsCard } from "../chat/needs-card-stand";
import { ThreadItemsView } from "../chat/ThreadItemsView";
import {
  NEEDS_ANSWER_PLATES,
  NEEDS_HANDLES,
  NEEDS_KIND_PLATES,
  NEEDS_LIVE_ITEMS,
  type NeedsPlate,
  needsLiveAnswerOf,
  needsLiveEntryOf,
} from "./chat-fixtures";

// The needs-you card on fixtures (CP-3; DESIGN.md §8 "Chat's thread", the needs-you card; docs/UI_SYSTEM.md): the
// SHIPPING card (`NeedsCardView`) on the product's own reading of fixture items (`needsCardOf`, in `chat-fixtures.ts`)
// — each kind as it waits, a kind this build does not know, and what an answer does to it — by this page's light and
// by the Moon's, and in a narrow thread. Its sessions are named as Vela's @ names them (`NEEDS_HANDLES`, the
// product's `sessionHandlesOf` on the fixture board): a held send to "vibe-field", another to "vibe-field·2".
// And the card live: the product's own controller (`useNeedsCard`) standing it in the thread's items
// (`ThreadItemsView`) over three of Vela's items, its answers given by a fixture door after a beat, so its motion, its
// keyboard (Tab to an act, its ring; a pressed act puts the keyboard on the card) and its reduced motion are seen.
// Nothing here reaches fieldd, the feed or the status line; the markup and the CSS are the product's.

/** How long the live plate's fixture door takes to answer: long enough to see an answer run. */
export const LIVE_BEAT_MS = 900;

/** One still plate: the card as the thread would stand it, named under it. */
function Plate({ plate }: { plate: NeedsPlate }): ReactElement {
  return (
    <figure
      className="vf-ds-needs-plate"
      data-plate={plate.id}
      {...(plate.narrow === true ? { "data-narrow": "" } : {})}
    >
      <div className="vf-ds-needs-plate-box">
        <NeedsCardView card={plate.card} />
      </div>
      <figcaption className="vf-ds-needs-plate-label">{plate.label}</figcaption>
    </figure>
  );
}

/** One row of every still plate: each kind as it waits, then what an answer does to it. */
function PlateRow({ night }: { night: boolean }): ReactElement {
  return (
    <div className={night ? "vf-ds-needs-plates dark" : "vf-ds-needs-plates"}>
      {[...NEEDS_KIND_PLATES, ...NEEDS_ANSWER_PLATES].map((plate) => (
        <Plate key={plate.id} plate={plate} />
      ))}
    </div>
  );
}

/** The still plates by this page's light, then by the Moon's. */
export function NeedsCardPlates(): ReactElement {
  return (
    <>
      <PlateRow night={false} />
      <PlateRow night />
    </>
  );
}

const MOTIONS = ["Full motion", "Reduced motion"] as const;

/** The live card: the product's controller over a fixture door. Answered, an item leaves the fixture queue as fieldd's
 * does (once the answer is recorded, before it returns), and the next card rises once the last has gone; Ask again
 * deals the three again. The plate is always on screen, so nothing is said off it. */
export function NeedsCardLivePlate(): ReactElement {
  const [queue, setQueue] = useState<readonly NeedsItem[]>(NEEDS_LIVE_ITEMS);
  const [motion, setMotion] = useState<(typeof MOTIONS)[number]>("Full motion");
  const again = useRef<HTMLButtonElement>(null);
  const doors = useMemo<NeedsCardDoors>(
    () => ({
      answer: (id: NeedsItemId, choice: number) =>
        new Promise<NeedsItem>((resolve, reject) => {
          const item = NEEDS_LIVE_ITEMS.find((each) => each.id === id);
          if (item === undefined) {
            reject(new Error("no such item"));
            return;
          }
          window.setTimeout(() => {
            setQueue((left) => left.filter((each) => each.id !== id));
            resolve(needsLiveAnswerOf(item, choice));
          }, LIVE_BEAT_MS);
        }),
      say: () => undefined,
      // the plate's stand-in for the draft: the act that deals the cards again
      focusDraft: () => again.current?.focus(),
    }),
    [],
  );
  const entry = useMemo(() => needsLiveEntryOf(queue), [queue]);
  const stand = useNeedsCard(entry, true, motion === "Reduced motion", doors, NEEDS_HANDLES);
  return (
    <div className="vf-ds-needs-live" data-plate="live">
      <div className="vf-ds-frame-controls">
        <SegmentedControl options={MOTIONS} value={motion} onChange={setMotion} label="Motion" />
        <UiButton
          ref={again}
          disabled={queue.length > 0}
          onClick={() => setQueue(NEEDS_LIVE_ITEMS)}
        >
          Ask again
        </UiButton>
      </div>
      <div className="vf-ds-needs-stage">
        <div className="vf-ds-needs-foot">
          <ThreadItemsView
            items={stand.card === null ? [] : [stand.card]}
            onAnswer={stand.answer}
            cardRef={stand.cardRef}
          />
        </div>
      </div>
    </div>
  );
}
