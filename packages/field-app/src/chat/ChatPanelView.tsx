import type { SparkId } from "@vibefield/contracts";
import { EmptyState, UiButton, UnavailableState } from "@vibefield/design-kit/primitives";
import {
  SparkFace,
  SparkStage,
  type SparkStatus,
  sparkStatusWord,
} from "@vibefield/design-kit/spark-face";
import { ChromeBoundary } from "@vibefield/puppeteer-views";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { COVER_RESERVE_PX, HEAD_BAND_PX } from "../frame/frame-geometry";
import { SparkPaneView } from "./SparkPaneView";
import { activityWords, type SparkEntry } from "./spark-status";
import type { SparksReading } from "./sparks-feed";
import { ThreadItemsView } from "./ThreadItemsView";
import type { ThreadItem } from "./thread-items";
import "./chat.css";

// CHAT, THE PANEL (SP-1b, SP-1d; DESIGN.md §8 "Chat's list", "Chat's thread"; the Sparks page's `ch-view`,
// `ch-needs`) — controller-free, so the catalog mounts this exact markup on fixtures. The list's column holds the
// sparks fieldd keeps, newest activity first (CH-D1); a row is the face, the name and the status word (CH-D3); the
// needs-you three take the attention ink and the orange dot (CH-D4). The thread's column is a fixed box: the chosen
// spark's head, then its own pane (the controller's `SparkPane`, handed in) — or, asleep or not started, one honest
// line with its one act — then the thread's foot: its composer, handed in, and its items standing over the pane.

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
  act?: ChatAct;
  onChoose?: (spark: SparkId) => void;
  /** its last session, resumed (`compose.sparks.open`) */
  onWake?: (entry: SparkEntry) => void;
  /** the shown spark's own pane, while it is awake (the product's `SparkPane`); absent, the pane's place says what a
   * window with no terminals says */
  pane?: ReactNode;
  /** what stands in the shown thread over its pane, in order (`threadItemsOf`) */
  items?: readonly ThreadItem[];
  /** a starter pressed in the thread's hello: its words, sent as Send sends */
  onStarter?: ((words: string) => void) | undefined;
  /** a send into the shown thread runs, a starter's or Send's: the starters wait */
  sending?: boolean | undefined;
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

/** The spark's line, or null while it is awake: then its pane is the thread (DESIGN.md §8 "Chat's thread"). */
export function threadLineOf(entry: SparkEntry): ThreadLine | null {
  if (entry.status === "sleeping") return "asleep";
  if (entry.run === null && entry.spark.session === undefined) return "not-started";
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
  act = { state: "idle" },
  onChoose,
  onWake,
  pane,
  items = [],
  onStarter,
  sending = false,
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
          <UnavailableState card title="Chat can't read your sparks" description={reading.reason} />
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
            items={items}
            onStarter={onStarter}
            sending={sending}
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
  time,
  onChoose,
}: {
  entry: SparkEntry;
  on: boolean;
  time: string;
  onChoose: ((spark: SparkId) => void) | undefined;
}): ReactElement {
  const { spark, status, needsYou } = entry;
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
      </span>
      {needsYou ? <span className="vf-chat-row-dot" aria-hidden="true" /> : null}
    </button>
  );
}

function ThreadColumn({
  entry,
  act,
  onWake,
  pane,
  items,
  onStarter,
  sending,
  composer,
}: {
  entry: SparkEntry;
  act: ChatAct;
  onWake: ((entry: SparkEntry) => void) | undefined;
  pane: ReactNode;
  items: readonly ThreadItem[];
  onStarter: ((words: string) => void) | undefined;
  sending: boolean;
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
      {line === null ? (
        // the pane is a chrome piece of its own, tried again for the session it shows
        <ChromeBoundary name="Spark pane" retryKey={paneSessionOf(entry) ?? spark.id}>
          {pane ?? <SparkPaneView name={spark.name} state="no-terminals" />}
        </ChromeBoundary>
      ) : (
        <p className="vf-chat-thread-line" data-line={line} role="status">
          <span>{lineWords(spark.name, line, act)}</span>
          {line === "asleep" ? (
            <UiButton disabled={act.state === "busy"} onClick={() => onWake?.(entry)}>
              {act.state === "busy" ? "Waking…" : "Wake"}
            </UiButton>
          ) : null}
        </p>
      )}
      <div className="vf-chat-foot">
        <ThreadItemsView items={items} onStarter={onStarter} sending={sending} />
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
