import type { NeedsItem, SparkId } from "@vibefield/contracts";
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
import { SparkPaneView } from "./SparkPaneView";
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
// one, said in the row's name too where it outlasts the word (SP-1d). The thread's column is a fixed box: the chosen
// spark's head, then its own pane (the controller's `SparkPane`, handed in) — or, asleep or not started, one honest
// line with its one act — then the thread's foot: its composer, handed in, and its items standing over the pane (a new
// spark's hello, or since CP-3 the needs-you card). TH-1: handed a `flow` (`ThreadFlowView`), the column is the head,
// the flow and the foot, and the items stand in the foot above the composer, covering nothing; the pane goes when
// Chat's controller hands the flow.

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
  /** the shown spark's own pane, while it is awake (the product's `SparkPane`); absent, the pane's place says what a
   * window with no terminals says */
  pane?: ReactNode;
  /** TH-1 — the shown spark's conversation, drawn (`ThreadFlowView`): handed, it stands in the pane's place, awake or
   * asleep, and the thread's items stand in the foot above the composer, covering nothing */
  flow?: ReactNode;
  /** what stands in the shown thread over its pane, in order (`threadItemsOf`) */
  items?: readonly ThreadItem[];
  /** a starter pressed in the thread's hello: its words, sent as Send sends */
  onStarter?: ((words: string) => void) | undefined;
  /** an act holds the shown thread — a send into it, a starter's or Send's, or a wake: Wake and the starters wait */
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

/** The line the thread's column says under the head in place of a pane: asleep, or not started. */
export type ThreadLine = "asleep" | "not-started";

/** The spark's line, or null while it is awake: then its pane is the thread (DESIGN.md §8 "Chat's thread"). Read from
 * its session (`awake`), never from its word: a sleeping spark with an item says Asking you or Needs your OK, and still
 * sleeps (§8 "Chat's list", the status as amended at CP-3). */
export function threadLineOf(entry: SparkEntry): ThreadLine | null {
  if (entry.run === null && entry.spark.session === undefined) return "not-started";
  if (!entry.awake) return "asleep";
  return null;
}

/** The floor session the spark's own run's terminal is — the board's row first, else its record — or null while
 * fieldd has not named one (just after a hatch or a wake). */
export function paneSessionOf(entry: SparkEntry): string | null {
  return entry.run?.terminal?.runtimeSessionId ?? entry.spark.session?.terminalSessionId ?? null;
}

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
  pane,
  flow,
  items = [],
  onStarter,
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
            pane={pane}
            flow={flow}
            items={items}
            onStarter={onStarter}
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
  pane,
  flow,
  items,
  onStarter,
  sending,
  onAnswer,
  onShowAsk,
  cardRef,
  composer,
}: {
  entry: SparkEntry;
  act: ChatAct;
  onWake: ((entry: SparkEntry) => void) | undefined;
  pane: ReactNode;
  flow: ReactNode;
  items: readonly ThreadItem[];
  onStarter: ((words: string) => void) | undefined;
  sending: boolean;
  onAnswer: ((item: NeedsItem, choice: number) => void) | undefined;
  onShowAsk: ((item: NeedsItem) => void) | undefined;
  cardRef: Ref<HTMLDivElement> | undefined;
  composer: ReactNode;
}): ReactElement {
  const { spark, status, needsYou } = entry;
  const line = threadLineOf(entry);
  return (
    <section className="vf-chat-thread" aria-label={`${spark.name}'s thread`}>
      <header className="vf-chat-thread-head">
        <SparkFace seed={spark.face.seed} status={status} size={40} live />
        <span className="vf-chat-thread-words">
          <span className="vf-chat-thread-name">{spark.name}</span>
          <span
            className="vf-chat-thread-status"
            {...(needsYou ? { "data-tone": "attention" } : {})}
          >
            {sparkStatusWord(status)}
          </span>
        </span>
      </header>
      {line === null && flow === undefined ? (
        // the pane is a chrome piece of its own, tried again for the session it shows
        <ChromeBoundary name="Spark pane" retryKey={paneSessionOf(entry) ?? spark.id}>
          {pane ?? <SparkPaneView name={spark.name} state="no-terminals" />}
        </ChromeBoundary>
      ) : line === null ? null : (
        <p className="vf-chat-thread-line" data-line={line} role="status">
          <span>{lineWords(spark.name, line, act)}</span>
          {line === "asleep" ? (
            <UiButton disabled={act.state === "busy" || sending} onClick={() => onWake?.(entry)}>
              {act.state === "busy" ? "Waking…" : "Wake"}
            </UiButton>
          ) : null}
        </p>
      )}
      {flow === undefined ? null : (
        // the flow is a chrome piece of its own, tried again for the spark it draws
        <ChromeBoundary name="Spark thread" retryKey={spark.id}>
          {flow}
        </ChromeBoundary>
      )}
      <div className="vf-chat-foot" {...(flow === undefined ? {} : { "data-flow": "" })}>
        <ThreadItemsView
          items={items}
          onStarter={onStarter}
          sending={sending}
          onAnswer={onAnswer}
          onShow={onShowAsk}
          cardRef={cardRef}
        />
        {composer}
      </div>
    </section>
  );
}

/** The one line under the head while there is no pane (DESIGN.md §8 "Chat's list", the thread's column as SP-1d
 * built it): asleep or not started, a wake under way, or a wake refused in fieldd's words. A refusal is said here only
 * when Wake asked; Send says its own in its note. */
function lineWords(name: string, line: ThreadLine, act: ChatAct): string {
  if (act.state === "refused") return `Couldn't wake ${name}: ${act.reason}`;
  switch (line) {
    case "asleep":
      return `${name} is asleep`;
    case "not-started":
      // no act of its own: Send wakes it, and the line says so while it does
      return act.state === "busy" ? "Waking…" : `${name} hasn't started yet`;
  }
}
