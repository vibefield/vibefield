import type { SparkId } from "@vibefield/contracts";
import { EmptyState, UiButton, UnavailableState } from "@vibefield/design-kit/primitives";
import {
  SparkFace,
  SparkStage,
  type SparkStatus,
  sparkStatusWord,
} from "@vibefield/design-kit/spark-face";
import type { CSSProperties, ReactElement } from "react";
import { COVER_RESERVE_PX, HEAD_BAND_PX } from "../frame/frame-geometry";
import { activityWords, type SparkEntry } from "./spark-status";
import type { SparksReading } from "./sparks-feed";
import "./chat.css";

// CHAT, THE PANEL (SP-1b; DESIGN.md §8 "Chat's list"; the Sparks page's `ch-view`, `ch-needs`) — controller-free, so
// the catalog mounts this exact markup on fixtures. The list's column holds the sparks fieldd keeps, newest activity
// first (CH-D1); a row is the face, the name and the status word (CH-D3); the needs-you three take the attention ink
// and the orange dot (CH-D4). The thread's column holds, until SP-1d mounts the spark's pane there, the chosen
// spark's head and one honest line with its one act.

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
  /** its pane, in Godview (History's Jump to) */
  onShow?: (entry: SparkEntry) => void;
  /** its last session, resumed (`compose.sparks.open`) */
  onWake?: (entry: SparkEntry) => void;
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

/** Which of the thread column's three honest lines the spark is on. */
export type ThreadLine = "in-godview" | "asleep" | "not-started";

export function threadLineOf(entry: SparkEntry): ThreadLine {
  if (entry.status === "sleeping") return "asleep";
  if (entry.run === null && entry.spark.session === undefined) return "not-started";
  return "in-godview";
}

export function ChatPanelView({
  reading,
  chosen,
  now,
  act = { state: "idle" },
  onChoose,
  onShow,
  onWake,
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
    const shown = entries.find((entry) => entry.spark.id === chosen) ?? entries[0];
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
          <ThreadColumn entry={shown} act={act} onShow={onShow} onWake={onWake} />
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
  onShow,
  onWake,
}: {
  entry: SparkEntry;
  act: ChatAct;
  onShow: ((entry: SparkEntry) => void) | undefined;
  onWake: ((entry: SparkEntry) => void) | undefined;
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
      <p className="vf-chat-thread-line" data-line={line} role="status">
        <span>{lineWords(spark.name, line, act)}</span>
        {line === "in-godview" ? (
          <UiButton disabled={act.state === "busy"} onClick={() => onShow?.(entry)}>
            {act.state === "busy" ? "Showing…" : "Show"}
          </UiButton>
        ) : line === "asleep" ? (
          <UiButton disabled={act.state === "busy"} onClick={() => onWake?.(entry)}>
            {act.state === "busy" ? "Waking…" : "Wake"}
          </UiButton>
        ) : null}
      </p>
    </section>
  );
}

/** The one line under the head (DESIGN.md §8 "Chat's list", the thread's column at SP-1b), or what its act was refused. */
function lineWords(name: string, line: ThreadLine, act: ChatAct): string {
  if (act.state === "refused") {
    return line === "asleep"
      ? `Couldn't wake ${name}: ${act.reason}`
      : `Couldn't show ${name}'s pane: ${act.reason}`;
  }
  switch (line) {
    case "in-godview":
      return `${name}'s pane is in Godview`;
    case "asleep":
      return `${name} is asleep`;
    case "not-started":
      return `${name} hasn't started yet`;
  }
}
