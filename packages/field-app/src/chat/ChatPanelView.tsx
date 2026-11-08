import type { NeedsItem, SparkId } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { EmptyState, UiButton, UnavailableState } from "@vibefield/design-kit/primitives";
import {
  SparkFace,
  SparkStage,
  type SparkStatus,
  sparkStatusWord,
} from "@vibefield/design-kit/spark-face";
import { ChromeBoundary } from "@vibefield/puppeteer-views";
import type { CSSProperties, ReactElement, ReactNode, Ref } from "react";
import { COVER_RESERVE_PX, HEAD_BAND_PX } from "../frame/frame-geometry";
import { headActOf, NO_PAUSE, type PauseAct } from "./head-act";
import { activityWords, type SparkEntry } from "./spark-status";
import { SPARKS_UNREADABLE, type SparksReading } from "./sparks-feed";
import { ThreadItemsView } from "./ThreadItemsView";
import type { ThreadItem } from "./thread-items";
import { lastingMarkOf, NO_LATCHES, type ThreadMark, threadMarksOf } from "./thread-marks";
import "./chat.css";

// CHAT, THE PANEL (SP-1b, SP-1d; DESIGN.md §8 "Chat's list", "Chat's thread"; the Sparks page's `ch-view`,
// `ch-needs`) — controller-free, so the catalog mounts this exact markup on fixtures. The list's column holds the
// sparks fieldd keeps, newest activity first (CH-D1); a row is the face, the name and the status word (CH-D3); the
// needs-you three take the attention ink (CH-D4), and a row wears its thread's mark: the orange dot, or unread's cyan
// one, said in the row's name too where it outlasts the word (SP-1d). The thread's column is a fixed box (TH-1): the
// chosen spark's head, its conversation (`ThreadFlowView`, handed in), then the foot: what waits on you (the needs-you
// card, CP-3), above the composer, covering nothing. TH-2: the head carries the thread's act in its end slot
// (`head-act.ts`): Jump to awake, Wake asleep, and Pause current turn before Jump to while the spark's own run works;
// the status's place says a refused Wake or Pause, or a cancellation fieldd could not confirm.
// *Amended 2026-11-05 (TH-1, the pane leaves Chat):* the column was the head, the spark's own pane (`SparkPane`,
// handed in) or, asleep or not started, one honest line under the head, then the foot, whose items stood over the
// pane's bottom rows. The pane, its place's words and the line left Chat with TH-1; they are in git.

/** What the chosen spark's act is doing: at rest, under way, or refused in fieldd's words. */
export type ChatAct =
  | { readonly state: "idle" }
  | { readonly state: "busy" }
  | { readonly state: "refused"; readonly reason: string };

export interface ChatPanelViewProps {
  reading: SparksReading;
  /** the spark whose head the thread's column shows; null takes the newest */
  chosen: SparkId | null;
  /** the clock the rows' times are said by, epoch ms */
  now: number;
  /** each thread's mark, by its spark (the window's feed keeps them: `useThreadMarks`); absent, the reading's alone,
   * a need standing now */
  marks?: ReadonlyMap<SparkId, ThreadMark>;
  act?: ChatAct;
  onChoose?: (spark: SparkId) => void;
  /** its last session, resumed (`compose.sparks.open`) */
  onWake?: (entry: SparkEntry) => void;
  /** TH-2 — Jump to, in the head: the spark's own session in Godview (`reveal-run.ts`) */
  onJump?: ((entry: SparkEntry) => void) | undefined;
  /** TH-2 — Jump to is under way for the shown spark: its pill waits */
  jumping?: boolean | undefined;
  /** TH-2 — Pause current turn, in the head, while the spark's own run works (`agent.pause`) */
  onPause?: ((entry: SparkEntry) => void) | undefined;
  /** TH-2 — the shown spark's own Pause: pressed, sent or refused, for the turn it was pressed in */
  pause?: PauseAct | undefined;
  /** TH-1 — the shown spark's conversation, drawn (the product's and the catalog's `ThreadFlowView`), under the head,
   * awake or asleep; absent, the column is the head and the foot alone */
  flow?: ReactNode;
  /** what stands in the shown thread's foot, above the composer, in order (`footItemsOf`) */
  items?: readonly ThreadItem[];
  /** an act holds the shown thread — a send into it, a starter's or Send's, or a wake: Wake waits (the flow's starters
   * are handed the same fact) */
  sending?: boolean | undefined;
  /** CP-3 — an act pressed on the thread's needs-you card, by its place */
  onAnswer?: ((item: NeedsItem, choice: number) => void) | undefined;
  /** CP-3 — Show pressed on an agent's ask: its pane in Godview */
  onShowAsk?: ((item: NeedsItem) => void) | undefined;
  /** CP-3 — the needs-you card's own element (the controller puts the keyboard on it) */
  cardRef?: Ref<HTMLDivElement> | undefined;
  /** the shown thread's composer, in its foot (the product's `ChatComposer`; the catalog's `ChatComposerView`) */
  composer?: ReactNode;
  /** the locale the times are said in; the window's own when absent */
  locale?: string;
}

/** The statuses a face moves through while the spark works: "live while it works" (§2.10's table). */
const AT_WORK: ReadonlySet<SparkStatus> = new Set([
  "thinking",
  "planning",
  "searching",
  "reviewing",
  "running",
  "focus",
]);

/** The spark the thread's column shows: the chosen one while the list holds it, else the newest. */
export function shownOf(
  entries: readonly SparkEntry[],
  chosen: SparkId | null,
): SparkEntry | undefined {
  return entries.find((entry) => entry.spark.id === chosen) ?? entries[0];
}

export function ChatPanelView({
  reading,
  chosen,
  now,
  marks,
  act = { state: "idle" },
  onChoose,
  onWake,
  onJump,
  jumping = false,
  onPause,
  pause = NO_PAUSE,
  flow,
  items = [],
  sending = false,
  onAnswer,
  onShowAsk,
  cardRef,
  composer,
  locale,
}: ChatPanelViewProps): ReactElement {
  const place = {
    "--vf-chat-head": `${HEAD_BAND_PX}px`,
    "--vf-chat-reserve": `${COVER_RESERVE_PX}px`,
  } as CSSProperties;
  return (
    <div className="vf-chat" style={place}>
      <SparkStage className="vf-chat-panel">{panelOf()}</SparkStage>
    </div>
  );

  function panelOf(): ReactElement {
    if (reading.state === "opening") {
      return (
        <div className="vf-chat-panel-state">
          <EmptyState title="Opening Chat…" />
        </div>
      );
    }
    if (reading.state === "unavailable") {
      return (
        <div className="vf-chat-panel-state">
          <UnavailableState card title={SPARKS_UNREADABLE} description={reading.reason} />
        </div>
      );
    }
    const entries = reading.entries;
    if (entries.length === 0) {
      return (
        <div className="vf-chat-panel-state">
          <EmptyState title="No sparks yet" />
        </div>
      );
    }
    const shown = shownOf(entries, chosen);
    const marked = marks ?? threadMarksOf(entries, NO_LATCHES);
    return (
      <>
        <section className="vf-chat-list" aria-label="Sparks">
          <header className="vf-chat-list-head">
            <h2>Sparks</h2>
            <span className="vf-chat-count">{entries.length}</span>
          </header>
          <div className="vf-chat-rows">
            {entries.map((entry) => (
              <SparkRow
                key={entry.spark.id}
                entry={entry}
                on={entry === shown}
                mark={marked.get(entry.spark.id) ?? null}
                time={activityWords(entry.activityAt, now, locale)}
                onChoose={onChoose}
              />
            ))}
          </div>
        </section>
        {shown === undefined ? null : (
          <ThreadColumn
            entry={shown}
            act={act}
            onWake={onWake}
            onJump={onJump}
            jumping={jumping}
            onPause={onPause}
            pause={pause}
            flow={flow}
            items={items}
            sending={sending}
            onAnswer={onAnswer}
            onShowAsk={onShowAsk}
            cardRef={cardRef}
            composer={composer}
          />
        )}
      </>
    );
  }
}

function SparkRow({
  entry,
  on,
  mark,
  time,
  onChoose,
}: {
  entry: SparkEntry;
  on: boolean;
  mark: ThreadMark | null;
  time: string;
  onChoose: ((spark: SparkId) => void) | undefined;
}): ReactElement {
  const { spark, status, needsYou } = entry;
  const lasting = lastingMarkOf(entry, mark);
  return (
    <button
      type="button"
      className="vf-chat-row"
      data-spark={spark.id}
      aria-pressed={on}
      onClick={() => onChoose?.(spark.id)}
    >
      <SparkFace seed={spark.face.seed} status={status} size={40} live={AT_WORK.has(status)} />
      <span className="vf-chat-row-words">
        <span className="vf-chat-row-name">
          <span className="vf-chat-row-label">{spark.name}</span>
          <time className="vf-chat-row-time" dateTime={new Date(entry.activityAt).toISOString()}>
            {time}
          </time>
        </span>
        <span className="vf-chat-row-status" {...(needsYou ? { "data-tone": "attention" } : {})}>
          {sparkStatusWord(status)}
        </span>
        {/* the dot is a picture: what it says beyond the word is in the row's name ("Asleep, needed you") */}
        {lasting === null ? null : <span className="sr-only">{`, ${lasting}`}</span>}
      </span>
      {mark === null ? null : (
        <span className="vf-chat-row-dot" data-mark={mark} aria-hidden="true" />
      )}
    </button>
  );
}

function ThreadColumn({
  entry,
  act,
  onWake,
  onJump,
  jumping,
  onPause,
  pause,
  flow,
  items,
  sending,
  onAnswer,
  onShowAsk,
  cardRef,
  composer,
}: {
  entry: SparkEntry;
  act: ChatAct;
  onWake: ((entry: SparkEntry) => void) | undefined;
  onJump: ((entry: SparkEntry) => void) | undefined;
  jumping: boolean;
  onPause: ((entry: SparkEntry) => void) | undefined;
  pause: PauseAct;
  flow: ReactNode;
  items: readonly ThreadItem[];
  sending: boolean;
  onAnswer: ((item: NeedsItem, choice: number) => void) | undefined;
  onShowAsk: ((item: NeedsItem) => void) | undefined;
  cardRef: Ref<HTMLDivElement> | undefined;
  composer: ReactNode;
}): ReactElement {
  const { spark, status, needsYou } = entry;
  // a refused Wake is said in the status's place while the spark sleeps, Wake standing (TH-1, the line's words moved)
  const head = headActOf(entry, pause, act.state === "refused" ? act.reason : null);
  return (
    <section className="vf-chat-thread" aria-label={`${spark.name}'s thread`}>
      <header className="vf-chat-thread-head">
        <SparkFace seed={spark.face.seed} status={status} size={40} live />
        <span className="vf-chat-thread-words">
          <span className="vf-chat-thread-name">{spark.name}</span>
          <span
            className="vf-chat-thread-status"
            {...(needsYou || head.says !== null ? { "data-tone": "attention" } : {})}
          >
            {head.says ?? sparkStatusWord(status)}
          </span>
        </span>
        {head.main === null ? null : (
          // the head's end slot (TH-2): Pause while the run works, then the one place, Jump to or Wake
          <span className="vf-chat-thread-acts">
            {head.pause === null ? null : (
              <UiButton
                className="vf-chat-thread-act"
                data-act="pause"
                disabled={head.pause !== "ready"}
                running={head.pause === "pausing"}
                {...(head.pause === "pausing" ? { "aria-busy": true } : {})}
                onClick={() => onPause?.(entry)}
              >
                {head.pause === "pausing" ? "Pausing current turn…" : "Pause current turn"}
              </UiButton>
            )}
            {head.main === "jump" ? (
              <UiButton
                key="jump"
                className="vf-chat-thread-act"
                data-act="jump"
                aria-label={`Jump to ${spark.name}'s pane`}
                disabled={jumping}
                {...(jumping ? { "aria-busy": true } : {})}
                onClick={() => onJump?.(entry)}
              >
                <FieldGlyph name="jump" size={14} />
                <span>Jump to</span>
              </UiButton>
            ) : (
              <UiButton
                key="wake"
                className="vf-chat-thread-act"
                data-act="wake"
                disabled={act.state === "busy" || sending}
                running={act.state === "busy"}
                onClick={() => onWake?.(entry)}
              >
                <FieldGlyph name="resume" size={14} />
                <span>{act.state === "busy" ? "Waking…" : "Wake"}</span>
              </UiButton>
            )}
          </span>
        )}
      </header>
      {flow === undefined ? null : (
        // the flow is a chrome piece of its own, tried again for the spark it draws
        <ChromeBoundary name="Spark thread" retryKey={spark.id}>
          {flow}
        </ChromeBoundary>
      )}
      <div className="vf-chat-foot">
        <ThreadItemsView items={items} onAnswer={onAnswer} onShow={onShowAsk} cardRef={cardRef} />
        {composer}
      </div>
    </section>
  );
}
