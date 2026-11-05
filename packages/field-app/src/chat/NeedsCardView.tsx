import type { NeedsItem } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { UiButton } from "@vibefield/design-kit/primitives";
import {
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type NeedsCard, needsCardWords, needsRefused, needsSaid } from "./needs-card";
import "./needs-card.css";

// THE NEEDS-YOU CARD, DRAWN (CP-3; DESIGN.md §8 "Chat's thread", the needs-you card; the Sparks page's `qCard` and
// `askCard`) — controller-free, so the catalog draws this markup on fixtures. One of the thread's items: it stands in
// the foot's overlay (`.vf-chat-items`) by the items' one rule, over the pane, never in its flow; under a drawn
// conversation, held in the foot above the composer (TH-1). Since TH-1 the spark's own run's ask is a card too
// (`data-own`), its question in the spark's name and its eyebrow the word alone. Its rows stand 5
// apart — the eyebrow (with "1 of 3" at its right), the question, the held words, the sub — then its acts, the kit's
// buttons by their place; answered here, one line of what you said in their place. What it is doing is the card's
// `act`, and how it moves its `leaving` and `reduced` (`needs-card.ts`); keeping it standing is `useNeedsCard`'s.

export interface NeedsCardViewProps {
  card: NeedsCard;
  /** an act pressed, by its place among the item's acts (absent: the catalog, where nothing is answered) */
  onAnswer?: ((item: NeedsItem, choice: number) => void) | undefined;
  /** Show pressed: the agent's ask's pane in Godview (absent: the catalog) */
  onShow?: ((item: NeedsItem) => void) | undefined;
  /** the card itself, which takes the keyboard while it answers and when it takes a leaving card's place */
  ref?: Ref<HTMLDivElement> | undefined;
}

/** The question and the held words show six lines at most; past that each scrolls within itself under the scroll
 * fade, so nothing you answer is hidden. Measured where it stands: the fade is worn only while there is more. */
function ScrollText({
  className,
  id,
  children,
}: {
  className: string;
  id?: string | undefined;
  children: ReactNode;
}): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const measure = useCallback((): void => {
    const element = box.current;
    if (element !== null) setOver(element.scrollHeight > element.clientHeight + 1);
  }, []);
  // its words can change while its box keeps its height (a held send's "and 2 more"): measured at each draw
  useLayoutEffect(measure);
  // and when its width does (a thread narrowed)
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);
  return (
    <div ref={box} className={className} id={id} {...(over ? { "data-overflow": "" } : {})}>
      {children}
    </div>
  );
}

export function NeedsCardView({ card, onAnswer, onShow, ref }: NeedsCardViewProps): ReactElement {
  const { item, act, leaving, reduced } = card;
  const said = needsCardWords(card);
  const wordsId = useId();
  const subId = useId();
  // announced once, as it arrives: the words it arrived with, by its item, though a name in them moves after (a
  // session's handle, read once the Agent Profiles are; a namesake that ends) — its drawn words follow the names live
  const arrival = useRef({ id: item.id, asked: said.asked });
  if (arrival.current.id !== item.id) arrival.current = { id: item.id, asked: said.asked };
  const answered = act.state === "said" ? needsSaid(item, act.choice, card.names) : null;
  const busy = act.state === "busy" ? act.choice : null;
  // every act waits while an answer runs, and none answers once the item waits no longer (a refused card's note)
  const quiet = busy !== null || !card.waits;
  // ringed while it waits on you: its item waits in the queue, or your answer to it runs (fieldd drops the item once
  // it has recorded the answer); answered here, or its item gone, it waits on no one
  const waits = answered === null && (card.waits || busy !== null);
  const described = [said.words === null ? null : wordsId, said.sub === null ? null : subId]
    .filter((id) => id !== null)
    .join(" ");
  return (
    // biome-ignore lint/a11y/useSemanticElements: a card that asks and its acts, not a fieldset of form inputs
    <div
      ref={ref}
      className="vf-needs-card"
      data-item="needs"
      data-kind={item.kind}
      data-act={act.state}
      {...(card.own ? { "data-own": "" } : {})}
      role="group"
      aria-label={said.label}
      tabIndex={-1}
      {...(described === "" ? {} : { "aria-describedby": described })}
      {...(waits ? { "data-waits": "" } : {})}
      {...(leaving ? { "data-leaving": "", inert: true } : {})}
      {...(reduced ? { "data-motion": "reduced" } : {})}
    >
      <div className="vf-needs-head">
        <span className="vf-needs-eyebrow">{said.eyebrow}</span>
        {said.place !== null && answered === null ? (
          <span className="vf-needs-place">{said.place}</span>
        ) : null}
      </div>
      <ScrollText className="vf-needs-question">{said.question}</ScrollText>
      {said.words === null ? null : (
        <ScrollText className="vf-needs-words" id={wordsId}>
          {said.words}
          {said.more === null ? null : <span className="vf-needs-more"> {said.more}</span>}
        </ScrollText>
      )}
      {said.sub === null ? null : (
        <p className="vf-needs-sub" id={subId}>
          {said.sub}
        </p>
      )}
      {act.state === "refused" ? (
        <p className="vf-needs-refused" role="status">
          {needsRefused(act.reason)}
        </p>
      ) : null}
      {answered !== null ? (
        <p className="vf-needs-said" role="status" data-tone={answered.tone}>
          <FieldGlyph name={answered.tone === "failed" ? "exclaim" : "check"} size={13} />
          <span>{answered.text}</span>
        </p>
      ) : said.acts.length > 0 || said.show ? (
        <div className="vf-needs-acts" {...(busy === null ? {} : { "aria-busy": true })}>
          {said.acts.map((each) =>
            each.choice === busy ? (
              // the pressed one keeps its look and says its word with an ellipsis; a press does nothing
              <UiButton
                key={each.choice}
                className="vf-needs-act"
                variant={each.primary ? "primary" : "quiet"}
                aria-disabled="true"
                data-pressed=""
              >
                {`${each.word}…`}
              </UiButton>
            ) : (
              <UiButton
                key={each.choice}
                className="vf-needs-act"
                variant={each.primary ? "primary" : "quiet"}
                disabled={quiet}
                onClick={() => onAnswer?.(item, each.choice)}
              >
                {each.word}
              </UiButton>
            ),
          )}
          {said.show ? (
            <UiButton className="vf-needs-act" variant="quiet" onClick={() => onShow?.(item)}>
              Show
            </UiButton>
          ) : null}
        </div>
      ) : null}
      {act.state === "idle" && !leaving ? (
        // announced once, politely, as it arrives
        <span className="vf-needs-arrived" role="status">
          {arrival.current.asked}
        </span>
      ) : null}
    </div>
  );
}
