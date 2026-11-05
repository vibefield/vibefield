import {
  type ComposeSayChip,
  type CrewId,
  composeSayStateOf,
  type SparkTranscriptKnownLine,
  type SparkTranscriptRun,
} from "@vibefield/contracts";
import type { SparkStatus } from "@vibefield/design-kit/spark-face";
import type { SparkEntry } from "./spark-status";
import { helloWords, STARTERS, type Starter, sparkIsNew } from "./thread-items";
import type { TranscriptReading } from "./transcript-port";

// THE FLOW, AS DATA (TH-1; DESIGN.md §8 "Chat's thread", §9 "Chat's words"). Pure: the spark's record as the reader
// holds it, Chat's reading of the spark, and this window's own sends the record does not show yet, in; the flow's rows,
// top to bottom, out. The latest conversation (its runs joined) is drawn, the earlier ones behind one row until asked
// for (TH-Q14 (b), TH0-Q6 (c)); your words with their chips and their receipt, Vela's replies whole, its tools one
// line a turn by kind, VibeField's own acts, the hello while the spark is new and its conversation empty, Thinking…
// while its own run works, day lines, and the three honest lines. A word this build does not know draws no word of
// its own (the tolerant reader).

/** A send this window made that the record does not show yet: drawn at the press, matched to its `you` line by its
 * request id. `state` is the say's receipt, absent until fieldd answers. */
export interface PendingSay {
  readonly requestId: string;
  readonly text: string;
  readonly chips: readonly ComposeSayChip[];
  /** when it was pressed (ISO) */
  readonly at: string;
  readonly state?: string | undefined;
}

/** A receipt under your bubble, in the phone's words (§9 "Chat on the phone"). */
export interface Receipt {
  readonly words: string;
  readonly tone?: "attention";
}

/** One tool of a turn's folded line: its kind's words and what it touched. */
export interface ToolRow {
  readonly words: string;
  readonly detail?: string | undefined;
}

export type FlowItem =
  | { readonly kind: "earlier"; readonly key: string; readonly count: number }
  | { readonly kind: "day"; readonly key: string; readonly words: string }
  | {
      readonly kind: "honest";
      readonly key: string;
      readonly which: "before" | "gap" | "dropped";
      readonly words: string;
    }
  | {
      readonly kind: "hello";
      readonly key: string;
      readonly face: { readonly seed: number; readonly status: SparkStatus };
      readonly words: string;
      readonly starters: readonly Starter[];
    }
  | {
      readonly kind: "you";
      readonly key: string;
      readonly text: string;
      readonly chips: readonly ComposeSayChip[];
      readonly receipt: Receipt | null;
    }
  | { readonly kind: "reply"; readonly key: string; readonly text: string; readonly lead: boolean }
  | {
      readonly kind: "tools";
      readonly key: string;
      readonly words: string;
      readonly rows: readonly ToolRow[];
      readonly lead: boolean;
    }
  | {
      readonly kind: "act";
      readonly key: string;
      readonly what: string;
      readonly words: string;
      readonly lead: boolean;
      /** SP-1e2 — a crew's line names its crew: its card hangs under it, and a later line of the crew replaces it */
      readonly crew?: CrewId | undefined;
    }
  | { readonly kind: "thinking"; readonly key: string; readonly lead: boolean };

/** What the flow draws: its rows, or why there are none to draw yet. */
export type Flow =
  | { readonly state: "reading" }
  | { readonly state: "unreadable"; readonly reason: string }
  | { readonly state: "ready"; readonly items: readonly FlowItem[] };

export interface FlowInputs {
  readonly entry: SparkEntry;
  readonly reading: TranscriptReading;
  /** this window's sends the record may not show yet, oldest first */
  readonly pending?: readonly PendingSay[] | undefined;
  /** the earlier conversations were asked for */
  readonly earlier?: boolean | undefined;
  /** the window's clock, epoch ms, for the day lines */
  readonly now: number;
  readonly locale?: string | undefined;
}

// ── the words (§9 "Chat's words") ──

export const FLOW_WORDS = {
  reading: (name: string) => `Reading ${name}'s conversation…`,
  unreadable: (name: string, reason: string) => `Couldn't read ${name}'s conversation: ${reason}`,
  earlier: (count: number) => `Earlier conversations (${count})`,
  conversation: (date: string) => `A new conversation · ${date}`,
  thinking: "Thinking…",
  tools: (count: number) => `Used ${count} ${count === 1 ? "tool" : "tools"}`,
  before: (name: string) => `Earlier messages are in ${name}'s terminal`,
  gap: (name: string) =>
    `Part of this conversation happened while VibeField restarted — it's in ${name}'s terminal`,
  dropped: "Part of this conversation couldn't be checked, so it isn't shown",
} as const;

/** Each of the agent runtime's seven tool kinds in VibeField's words, never a tool's own name (AR-L1). */
export const TOOL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  command: "Ran a command",
  "web-search": "Searched the web",
  "file-read": "Read a file",
  "file-edit": "Edited a file",
  browser: "Used the browser",
  mcp: "Used a tool",
  other: "Used a tool",
});

/** A tool's kind in VibeField's words; a kind this build does not know is a tool. */
export function toolWords(kind: string): string {
  return TOOL_WORDS[kind] ?? "Used a tool";
}

/** VibeField's own act, in its words (TH-Q12 (a), CO-Q1 (b)); one this build does not know, in its own. */
export function actWords(what: string, text: string, name: string): string {
  switch (what) {
    case "wake":
      return `VibeField told ${name}: ${text}`;
    case "answer":
      return `You answered ${name}: ${text}`;
    case "notify":
      return `${name} told you: ${text}`;
    default:
      return text;
  }
}

/** Your bubble's receipt (TH-Q4 (a); PC-L1, the phone's words with Chat's straight apostrophes): the state fieldd
 * last said, read with the spark as Chat reads it now — busy, or waiting on you. "Delivered" is said under your last
 * bubble alone. A state this build does not know, or none yet, says nothing. */
export function receiptOf(
  state: string | undefined,
  entry: SparkEntry,
  last: boolean,
): Receipt | null {
  const name = entry.spark.name;
  switch (state === undefined ? undefined : composeSayStateOf({ state })) {
    case "waking":
      return { words: `Waking ${name}…` };
    case "queued":
    case "waiting":
      if (entry.blocked || entry.items.length > 0)
        return { words: `Queued · it lands after you answer ${name}` };
      if (entry.run?.alive === true && entry.run.status === "working")
        return { words: `Queued · ${name} is busy; it lands when it's done` };
      return { words: "Queued" };
    case "delivered":
      return last ? { words: "Delivered" } : null;
    case "dropped":
      return { words: `Not delivered: ${name}'s session ended` };
    case "uncertain":
      return { words: `${name} may not have it: look in its pane`, tone: "attention" };
    default:
      return null;
  }
}

/** A chip's words in your bubble: its span of your words, and for a session the words before the run id it carries
 * for the spark's tools, which is never drawn ("Claude Code in vibe-field"). */
export function chipWordsOf(text: string, chip: ComposeSayChip): string {
  const words = text.slice(chip.start, chip.start + chip.length);
  return chip.kind === "session" ? words.replace(/\s*\(session [^)]*\)$/u, "") : words;
}

/** A day line's words: "Today", "Yesterday", else the weekday and the date ("Mon, Nov 2"), by the window's clock. */
export function dayWords(at: number, now: number, locale?: string): string {
  const day = new Date(at);
  const today = new Date(now);
  if (day.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (day.toDateString() === yesterday.toDateString()) return "Yesterday";
  return day.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
}

/** A conversation's date, as its opening line says it ("Nov 3"). */
function dateWords(at: number, locale?: string): string {
  return new Date(at).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

// ── the projection ──

/** One conversation: its runs, joined, oldest first. */
function conversationsOf(runs: readonly SparkTranscriptRun[]): SparkTranscriptRun[][] {
  const out: SparkTranscriptRun[][] = [];
  for (const run of runs) {
    const current = out[out.length - 1];
    if (current === undefined || run.fresh) out.push([run]);
    else current.push(run);
  }
  return out;
}

/** Your words before their receipt is laid: the input they were queued as, the state they were queued with, and
 * where they came from. */
interface YouDraft {
  readonly kind: "you-draft";
  readonly key: string;
  readonly text: string;
  readonly chips: readonly ComposeSayChip[];
  readonly input?: string | undefined;
  readonly state?: string | undefined;
  readonly terminal: boolean;
}

/** A row before its day line and its lead are laid. */
interface Row {
  readonly at: number;
  readonly item: FlowItem | YouDraft;
}

const timeOf = (at: string): number => {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? 0 : ms;
};

/** The request ids of your sends the record shows (its `you` lines that carry one): their bubbles are the record's,
 * and this window's own are let go (`letGoPendingSays`). */
export function saidRequestsOf(reading: TranscriptReading): ReadonlySet<string> {
  const said = new Set<string>();
  if (reading.state !== "ready") return said;
  for (const run of reading.runs)
    for (const line of reading.lines.get(run.runtimeRunId) ?? [])
      if (line.kind === "you" && line.requestId) said.add(line.requestId);
  return said;
}

/** The flow's rows, top to bottom. */
export function transcriptItemsOf({
  entry,
  reading,
  pending = [],
  earlier = false,
  now,
  locale,
}: FlowInputs): Flow {
  if (reading.state === "reading") return { state: "reading" };
  if (reading.state === "unreadable") return { state: "unreadable", reason: reading.reason };
  const name = entry.spark.name;
  const conversations = conversationsOf(reading.runs);
  const shown = earlier ? conversations : conversations.slice(-1);
  const hidden = conversations.length - shown.length;
  const lines = reading.runs.flatMap((run) => reading.lines.get(run.runtimeRunId) ?? []);
  const items: FlowItem[] = [];
  if (hidden > 0) items.push({ kind: "earlier", key: "earlier", count: hidden });
  if (reading.dropped > 0)
    items.push({ kind: "honest", key: "dropped", which: "dropped", words: FLOW_WORDS.dropped });

  // the record began after the spark first worked: those turns are in its terminal only, said at the top of the
  // first conversation, once it is drawn
  const first = reading.runs[0];
  const turnedAt = entry.spark.turnedAt;
  const before =
    typeof turnedAt === "string" &&
    (first === undefined || timeOf(first.startedAt) > timeOf(turnedAt));
  if (before && hidden === 0)
    items.push({ kind: "honest", key: "before", which: "before", words: FLOW_WORDS.before(name) });

  const said = saidRequestsOf(reading);
  const latest: Row[] = [];
  let latestSince: number | null = null;
  shown.forEach((runs, index) => {
    const opening = runs[0];
    let since: number | null = null;
    if (earlier && conversations.length > 1 && opening !== undefined) {
      since = timeOf(opening.startedAt);
      items.push({
        kind: "day",
        key: `conversation:${opening.runtimeRunId}`,
        words: FLOW_WORDS.conversation(dateWords(since, locale)),
      });
    }
    const rows = rowsOf(
      runs.flatMap((run) => reading.lines.get(run.runtimeRunId) ?? []),
      name,
      opening?.runtimeRunId ?? "none",
    );
    if (index < shown.length - 1)
      items.push(...withDays(receipted(rows, entry, lines), since, now, locale));
    else {
      latest.push(...rows);
      latestSince = since;
    }
  });

  // this window's sends the record does not show yet, newest last
  const waiting = pending.filter((say) => !said.has(say.requestId));
  for (const say of waiting) {
    latest.push({
      at: timeOf(say.at),
      item: {
        kind: "you-draft",
        key: `pending:${say.requestId}`,
        text: say.text,
        chips: say.chips,
        state: say.state,
        terminal: false,
      },
    });
  }

  // the hello: the first row, while the spark is new and its conversation holds no words of yours or Vela's
  const empty =
    waiting.length === 0 && !lines.some((line) => line.kind === "you" || line.kind === "reply");
  if (empty && sparkIsNew(entry)) {
    items.push({
      kind: "hello",
      key: "hello",
      face: { seed: entry.spark.face.seed, status: entry.status },
      words: helloWords(name),
      starters: STARTERS,
    });
  }
  items.push(...withDays(receipted(latest, entry, lines), latestSince, now, locale));
  // Thinking… at the foot while Vela's own run works, from its board row; it carries no text
  if (entry.awake && entry.run?.alive === true && entry.run.status === "working")
    items.push({ kind: "thinking", key: "thinking", lead: true });
  return { state: "ready", items: leadsOf(items) };
}

/** A conversation's lines as rows: replies (the latest for a message id, where it first stood), tools folded one line
 * a turn (VibeField's own left out), your words with what their receipt needs, VibeField's acts, and the gap line.
 * Turn edges and run lines are read for grouping and draw nothing; an outcome is read into its bubble's receipt. */
function rowsOf(lines: readonly SparkTranscriptKnownLine[], name: string, key: string): Row[] {
  const rows: Row[] = [];
  const replies = new Map<string, number>();
  // SP-1e2 (SPE-Q39 (a)) — a crew's act line, where it first stood: a later line of the crew says its latest words
  const crews = new Map<string, number>();
  let toolsAt = 0;
  let toolsTurn: string | undefined;
  let toolsKey = "";
  let toolRows: ToolRow[] | null = null;
  const closeTools = () => {
    if (toolRows !== null && toolRows.length > 0) {
      rows.push({
        at: toolsAt,
        item: {
          kind: "tools",
          key: toolsKey,
          words: FLOW_WORDS.tools(toolRows.length),
          rows: toolRows,
          lead: false,
        },
      });
    }
    toolRows = null;
  };
  for (const line of lines) {
    const at = timeOf(line.at);
    switch (line.kind) {
      case "tool":
        if (toolRows === null || toolsTurn !== line.turn) {
          closeTools();
          toolRows = [];
          toolsAt = at;
          toolsTurn = line.turn;
          toolsKey = `tools:${key}:${line.seq}`;
        }
        if (line.ours !== true)
          toolRows.push({ words: toolWords(line.toolKind), detail: line.detail });
        break;
      case "turn":
        if (line.edge !== "start") closeTools();
        break;
      case "run":
      case "outcome":
        break;
      case "reply": {
        closeTools();
        const item: FlowItem = {
          kind: "reply",
          key: `reply:${line.messageId}`,
          text: line.text,
          lead: false,
        };
        const held = replies.get(line.messageId);
        const was = held === undefined ? undefined : rows[held];
        if (held !== undefined && was !== undefined) rows[held] = { at: was.at, item };
        else {
          replies.set(line.messageId, rows.length);
          rows.push({ at, item });
        }
        break;
      }
      case "you":
        closeTools();
        rows.push({
          at,
          item: {
            kind: "you-draft",
            key: `you:${key}:${line.seq}`,
            text: line.text,
            chips: line.chips ?? [],
            input: line.input,
            state: line.state,
            terminal: line.via === "terminal",
          },
        });
        break;
      case "act": {
        closeTools();
        const crew = line.what === "crew" ? line.crew : undefined;
        const item: FlowItem = {
          kind: "act",
          key: crew === undefined ? `act:${key}:${line.seq}` : `act:crew:${crew}`,
          what: line.what,
          words: actWords(line.what, line.text, name),
          lead: false,
          ...(crew === undefined ? {} : { crew }),
        };
        const held = crew === undefined ? undefined : crews.get(crew);
        const was = held === undefined ? undefined : rows[held];
        if (held !== undefined && was !== undefined) rows[held] = { at: was.at, item };
        else {
          if (crew !== undefined) crews.set(crew, rows.length);
          rows.push({ at, item });
        }
        break;
      }
      case "gap":
        closeTools();
        rows.push({
          at,
          item: {
            kind: "honest",
            key: `gap:${key}:${line.seq}`,
            which: "gap",
            words: FLOW_WORDS.gap(name),
          },
        });
        break;
    }
  }
  closeTools();
  return rows;
}

/** Your bubbles' receipts, laid once every bubble of the conversation is known: the record's latest outcome for its
 * input over the state it was queued with, a pending send's own receipt, and "Delivered" under the last bubble alone.
 * Words typed into the terminal have none. */
function receipted(
  rows: readonly Row[],
  entry: SparkEntry,
  lines: readonly SparkTranscriptKnownLine[],
): { readonly at: number; readonly item: FlowItem }[] {
  const outcomes = new Map<string, string>();
  for (const line of lines) if (line.kind === "outcome") outcomes.set(line.of, line.state);
  let lastYou = -1;
  rows.forEach((row, index) => {
    if (row.item.kind === "you-draft" && !row.item.terminal) lastYou = index;
  });
  return rows.map((row, index) => {
    const draft = row.item;
    if (draft.kind !== "you-draft") return { at: row.at, item: draft };
    const state =
      (draft.input === undefined ? undefined : outcomes.get(draft.input)) ?? draft.state;
    return {
      at: row.at,
      item: {
        kind: "you",
        key: draft.key,
        text: draft.text,
        chips: draft.chips,
        receipt: draft.terminal ? null : receiptOf(state, entry, index === lastYou),
      },
    };
  });
}

/** Day lines laid where the day changes: before the first row, unless the line above it (a conversation's opening)
 * already said that day. */
function withDays(
  rows: readonly { readonly at: number; readonly item: FlowItem }[],
  since: number | null,
  now: number,
  locale: string | undefined,
): FlowItem[] {
  const out: FlowItem[] = [];
  let day = since === null ? null : new Date(since).toDateString();
  for (const row of rows) {
    const here = new Date(row.at).toDateString();
    if (here !== day)
      out.push({ kind: "day", key: `day:${row.item.key}`, words: dayWords(row.at, now, locale) });
    day = here;
    out.push(row.item);
  }
  return out;
}

const VELAS = new Set<FlowItem["kind"]>(["reply", "tools", "act", "thinking"]);

/** Vela's face leads once per run of its rows: a reply, a quiet line or Thinking… right after another of Vela's rows
 * does not repeat it. */
function leadsOf(items: readonly FlowItem[]): FlowItem[] {
  return items.map((item, index) => {
    if (
      item.kind !== "reply" &&
      item.kind !== "tools" &&
      item.kind !== "act" &&
      item.kind !== "thinking"
    )
      return item;
    const after = items[index - 1];
    return { ...item, lead: after === undefined || !VELAS.has(after.kind) };
  });
}
