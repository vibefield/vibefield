import type { SparkId } from "@vibefield/contracts";
import { UiButton } from "@vibefield/design-kit/primitives";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { crewCardsOf, crewsOfFlow } from "../chat/crew-card";
import { type CrewsDoor, useSparkCrews } from "../chat/crews-port";
import { ThreadFlowView } from "../chat/ThreadFlowView";
import { ThreadItemsView } from "../chat/ThreadItemsView";
import { footItemsOf } from "../chat/thread-items";
import { transcriptItemsOf } from "../chat/transcript-items";
import { FIXTURE_NOW } from "./chat-fixtures";
import {
  CREW_LIVE_STEPS,
  CREW_LIVE_VELA,
  CREW_PLATES,
  type CrewPlate,
  crewLiveEntryOf,
  crewLiveHandlesOf,
} from "./crew-fixtures";

// Chat's crew card on fixtures (SP-1e2's renderer half; DESIGN.md §8 "Chat's crew card"; docs/UI_SYSTEM.md): the
// SHIPPING card (`CrewCardView`) inside the SHIPPING thread view (`ThreadFlowView`), each plate the product's own
// reading of fixture record lines, crews and board rows (`crew-fixtures.ts`) — starting, at work with a member's ask
// at the foot (the shipping `ThreadItemsView`), All done, a member ended and the others renumbered, after a reload,
// either door unreadable and both, Vela asleep, two crews at their times, and SR-Q11's — by this page's light and by
// the Moon's. And the card live: the product's own reader (`useSparkCrews`, over a fixture door) and `crewCardsOf`,
// the door stepping a crew from starting to "All done" a beat at a time. Its rows and its foot open nothing outside the
// plate; nothing here reaches fieldd, the feed, the line or Godview. The markup and the CSS are the product's.

/** How long each live beat stands: long enough to see a row change and the ring ease. */
export const CREW_BEAT_MS = 1400;

/** One still plate: Vela's flow with its crews' cards, the foot's card under it, named under it. */
function Plate({ plate, locale }: { plate: CrewPlate; locale?: string | undefined }): ReactElement {
  const flow = transcriptItemsOf({
    entry: plate.entry,
    reading: plate.reading,
    now: FIXTURE_NOW,
    locale,
  });
  return (
    <figure
      className="vf-ds-crew-plate"
      data-plate={plate.id}
      {...(plate.narrow === true ? { "data-narrow": "" } : {})}
    >
      <div className="vf-ds-crew-plate-box">
        <ThreadFlowView
          flow={flow}
          name={plate.entry.spark.name}
          face={{ seed: plate.entry.spark.face.seed, status: plate.entry.status }}
          crews={plate.cards}
        />
        <ThreadItemsView items={footItemsOf(plate.foot)} />
      </div>
      <figcaption className="vf-ds-crew-plate-label">{plate.label}</figcaption>
    </figure>
  );
}

function PlateRow({
  night,
  locale,
}: {
  night: boolean;
  locale?: string | undefined;
}): ReactElement {
  return (
    <div className={night ? "vf-ds-crew-plates dark" : "vf-ds-crew-plates"}>
      {CREW_PLATES.map((plate) => (
        <Plate key={plate.id} plate={plate} locale={locale} />
      ))}
    </div>
  );
}

/** The still plates by this page's light, then by the Moon's. */
export function CrewCardPlates({ locale }: { locale?: string }): ReactElement {
  return (
    <>
      <PlateRow night={false} locale={locale} />
      <PlateRow night locale={locale} />
    </>
  );
}

/** The live card: the product's reader over a fixture door that hands a beat's frame on, and the board's rows of that
 * beat; Start again deals it from the first beat. The plate is always on screen, so nothing is said off it. */
export function CrewCardLivePlate({ locale }: { locale?: string }): ReactElement {
  const [beat, setBeat] = useState(0);
  const last = CREW_LIVE_STEPS.length - 1;
  const heard = useRef(new Set<(payload: unknown) => void>());
  const now = useRef(beat);
  now.current = beat;
  const door = useMemo<CrewsDoor>(
    () => ({
      watch: async (_spark: SparkId, onFrame) => {
        heard.current.add(onFrame);
        onFrame(CREW_LIVE_STEPS[now.current]?.frame);
        return () => {
          heard.current.delete(onFrame);
        };
      },
      onReconnected: () => () => undefined,
    }),
    [],
  );
  useEffect(() => {
    const frame = CREW_LIVE_STEPS[beat]?.frame;
    for (const onFrame of heard.current) onFrame(frame);
    if (beat >= last) return;
    const timer = window.setTimeout(() => setBeat((at) => at + 1), CREW_BEAT_MS);
    return () => window.clearTimeout(timer);
  }, [beat, last]);
  const step = CREW_LIVE_STEPS[beat] ?? CREW_LIVE_STEPS[0];
  const reading = useSparkCrews(CREW_LIVE_VELA.id, door);
  if (step === undefined) throw new Error("the live crew has no beats");
  const entry = crewLiveEntryOf(step.rows);
  const flow = transcriptItemsOf({ entry, reading: step.reading, now: FIXTURE_NOW, locale });
  const cards = crewCardsOf({
    crews: crewsOfFlow(flow),
    reading: reading ?? { state: "reading" },
    rows: step.rows,
    handles: crewLiveHandlesOf(step.rows),
    name: entry.spark.name,
    asleep: !entry.awake,
  });
  return (
    <div className="vf-ds-crew-live" data-plate="live">
      <div className="vf-ds-frame-controls">
        <UiButton disabled={beat < last} onClick={() => setBeat(0)}>
          Start again
        </UiButton>
      </div>
      <div className="vf-ds-crew-plate-box" data-live="">
        <ThreadFlowView
          flow={flow}
          name={entry.spark.name}
          face={{ seed: entry.spark.face.seed, status: entry.status }}
          crews={cards}
        />
      </div>
    </div>
  );
}
